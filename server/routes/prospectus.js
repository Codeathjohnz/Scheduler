import { Router } from 'express'
import mammoth from 'mammoth'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { parseProspectusPdf } from '../utils/parseProspectusPdf.js'

const router = Router()

// ── Word (.docx) prospectus parsing ───────────────────────────────────────────
// A second prospectus format some departments use: a Word document with one
// table per year-level/semester (e.g. "FIRST YEAR 1ST SEMESTER"), each row
// laid out as Course No. | Descriptive Title | Lec | Lab | Units | Prerequisite
// — a different column order than the Excel format's parser (client-side,
// FacultyLoad.jsx). Parsed here (not client-side) since it needs mammoth.

const YEAR_WORD = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4 }

function extractTableRows(tableHtml) {
  const rows = []
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let trMatch
  while ((trMatch = trRegex.exec(tableHtml))) {
    const cells = []
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g
    let tdMatch
    while ((tdMatch = tdRegex.exec(trMatch[1]))) {
      const text = tdMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
      cells.push(text)
    }
    rows.push(cells)
  }
  return rows
}

function parseDocxProspectus(html) {
  const subjects = []
  const tableRegex = /<table>([\s\S]*?)<\/table>/g
  let tableMatch
  while ((tableMatch = tableRegex.exec(html))) {
    const rows = extractTableRows(tableMatch[1])
    if (!rows.length) continue

    // First row of the table names the year level/semester, e.g. "FOURTH YEAR 2ND SEMESTER"
    const headerMatch = rows[0].join(' ').match(/(FIRST|SECOND|THIRD|FOURTH)\s+YEAR\s+(\d)(?:ST|ND|RD|TH)\s+SEMESTER/i)
    if (!headerMatch) continue   // not a curriculum table (title page, summary, etc.)
    const yearLevel = YEAR_WORD[headerMatch[1].toUpperCase()]
    const semester = parseInt(headerMatch[2], 10)

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i]
      if (cells.length !== 6) continue   // header/sub-header rows have 5 or 2 cells
      const [code, title, lec, lab, units, prereq] = cells.map(c => c.trim())
      if (!code || !title || title.toLowerCase() === 'total') continue
      const unitsNum = parseFloat(units)
      if (isNaN(unitsNum)) continue
      subjects.push({
        course_code: code,
        descriptive_title: title,
        units: unitsNum,
        lec_hours: parseFloat(lec) || 0,
        lab_hours: parseFloat(lab) || 0,
        year_level: yearLevel,
        semester,
        prerequisite: prereq && prereq.toLowerCase() !== 'none' ? prereq : null,
      })
    }
  }
  return subjects
}

// POST /api/prospectus/parse-docx — body: { data: base64 } — parses a Word
// prospectus and returns the same subjects[] shape the Excel client parser
// produces, ready for the same preview/import flow.
router.post('/parse-docx', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { data } = req.body
  if (!data) {
    return res.status(400).json({ message: 'No file data provided.' })
  }
  try {
    const buffer = Buffer.from(data, 'base64')
    const result = await mammoth.convertToHtml({ buffer })
    const subjects = parseDocxProspectus(result.value)
    if (!subjects.length) {
      return res.status(400).json({ message: 'No subjects found. Make sure each year level/semester is in its own table with a "{YEAR} YEAR {N} SEMESTER" heading.' })
    }
    res.json({ subjects })
  } catch (err) {
    res.status(500).json({ message: 'Failed to parse Word document.', error: err.message })
  }
})

// POST /api/prospectus/parse-pdf — body: { data: base64 } — OCR-based parser
// for the OLD prospectus format some departments only have as a scanned PDF
// (no selectable text layer at all, confirmed against real samples — this is
// real OCR, not text extraction). Deliberately much less trustworthy than
// parse-docx/the Excel path: titles, course codes, and prerequisites OCR
// well, but Lec/Lab/Units digits do not (measured ~50-60% accuracy even
// after isolating each cell) — every row comes back with a `needsReview`
// flag where the parser itself couldn't read it at all, but a false "clean"
// row is NOT a guarantee the numbers are right. The client must show an
// editable preview for this path, not the read-only one used for xlsx/docx.
router.post('/parse-pdf', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { data } = req.body
  if (!data) {
    return res.status(400).json({ message: 'No file data provided.' })
  }
  try {
    const buffer = Buffer.from(data, 'base64')
    const subjects = await parseProspectusPdf(buffer)
    res.json({ subjects })
  } catch (err) {
    res.status(400).json({ message: err.message || 'Failed to read the PDF.' })
  }
})

// GET /api/prospectus  — list uploaded prospectuses (chair sees only their own)
router.get('/', authenticate, async (req, res) => {
  const isChair = req.user.role === 'chair'
  try {
    const [rows] = await pool.query(`
      SELECT p.*, u.name AS uploaded_by_name,
        (SELECT COUNT(*) FROM prospectus_subjects ps WHERE ps.prospectus_id = p.id) AS subject_count
      FROM prospectus p
      JOIN users u ON p.uploaded_by = u.id
      ${isChair ? 'WHERE p.uploaded_by = ?' : ''}
      ORDER BY p.created_at DESC
    `, isChair ? [req.user.id] : [])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Four disjoint pools, same convention as facultyload.js: General Education
// ("GE" prefix), PATHFIT ("PATHFIT" prefix), and NSTP ("NSTP" prefix)
// subjects are repeated inside every department's prospectus (every
// program's curriculum includes them) — a GE, PATHFIT, or NSTP instructor
// should only ever see their own pool, and a department instructor (BSCE,
// CCIS, ...) should never see any of those pools mixed into their list.
function isGeneralEd(courseCode) {
  return /^GE\b/i.test(String(courseCode || '').trim())
}
function isPathfit(courseCode) {
  return /^PATHFIT\b/i.test(String(courseCode || '').trim())
}
function isNstp(courseCode) {
  return /^NSTP\b/i.test(String(courseCode || '').trim())
}

// Union of subjects matching `matches` across the latest prospectus of every
// department, deduped by course code — used for the GE, PATHFIT, and NSTP
// pools, which are typed into every department's prospectus rather than
// owning one of their own.
async function pooledSubjects(matches, semester) {
  const params = []
  let semFilter = ''
  if (semester) { semFilter = 'AND ps.semester = ?'; params.push(semester) }
  const [rows] = await pool.query(`
    SELECT ps.*
    FROM prospectus_subjects ps
    JOIN prospectus p ON ps.prospectus_id = p.id
    JOIN users u ON p.uploaded_by = u.id
    JOIN (
      SELECT u2.department, MAX(p2.created_at) AS max_created
      FROM prospectus p2 JOIN users u2 ON p2.uploaded_by = u2.id
      GROUP BY u2.department
    ) latest ON latest.department = u.department AND latest.max_created = p.created_at
    WHERE 1=1 ${semFilter}
    ORDER BY ps.year_level, ps.semester, ps.id
  `, params)
  const seen = new Set()
  return rows.filter(s => {
    if (!matches(s.course_code)) return false
    const key = s.course_code.trim().toUpperCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Union of subjects across every CHAIR's latest prospectus within one
// department, GE/PATHFIT/NSTP rows excluded — not just the single most
// recently uploaded prospectus department-wide. A department can have
// several chairs each owning a different program (e.g. CCIS has a BSIT
// chair and a BSIS chair); picking only the newest upload would make the
// other chair's program invisible to that department's instructors as soon
// as anyone else in the department uploaded more recently. Rows are not
// deduped by course code — unlike the GE/PATHFIT/NSTP pools, each program's
// copy of a subject is its own prospectus_subjects row (and instructor
// specialties are selected per row), so a subject two programs happen to
// share still needs to appear once per program.
async function departmentSubjects(department, semester) {
  const params = [department, department]
  let semFilter = ''
  if (semester) { semFilter = 'AND ps.semester = ?'; params.push(semester) }
  const [rows] = await pool.query(`
    SELECT ps.*
    FROM prospectus_subjects ps
    JOIN prospectus p ON ps.prospectus_id = p.id
    JOIN users u ON p.uploaded_by = u.id
    JOIN (
      SELECT p2.uploaded_by, MAX(p2.created_at) AS max_created
      FROM prospectus p2 JOIN users u2 ON p2.uploaded_by = u2.id
      WHERE u2.department = ?
      GROUP BY p2.uploaded_by
    ) latest ON latest.uploaded_by = p.uploaded_by AND latest.max_created = p.created_at
    WHERE u.department = ? ${semFilter}
    ORDER BY ps.year_level, ps.semester, ps.id
  `, params)
  return rows.filter(s => !isGeneralEd(s.course_code) && !isPathfit(s.course_code) && !isNstp(s.course_code))
}

// GET /api/prospectus/latest/subjects?semester=1  — subjects from the most
// recent prospectus for the caller's own department (a Chair's own uploads,
// unfiltered — they need to see everything, GE/PATHFIT/NSTP included, to
// build their course offering). For an Instructor: a General Education
// instructor gets the union of GE rows across every department's latest
// prospectus; a PATHFIT instructor gets the union of PATHFIT rows the same
// way; an NSTP instructor gets the union of NSTP rows the same way; every
// other department instructor gets the union of every chair's latest
// prospectus within their own department (see departmentSubjects above),
// with all three pools excluded.
router.get('/latest/subjects', authenticate, async (req, res) => {
  const isChair = req.user.role === 'chair'
  const isGeInstructor      = !isChair && req.user.department === 'General Education'
  const isPathfitInstructor = !isChair && req.user.department === 'PATHFIT'
  const isNstpInstructor    = !isChair && req.user.department === 'NSTP'
  const { semester } = req.query
  try {
    if (isChair) {
      const [[latest]] = await pool.query(
        `SELECT id FROM prospectus WHERE uploaded_by = ? ORDER BY created_at DESC LIMIT 1`,
        [req.user.id]
      )
      if (!latest) return res.json([])
      const params = [latest.id]
      let semFilter = ''
      if (semester) { semFilter = 'AND semester = ?'; params.push(semester) }
      const [subjects] = await pool.query(
        `SELECT * FROM prospectus_subjects WHERE prospectus_id = ? ${semFilter} ORDER BY year_level, semester, id`,
        params
      )
      return res.json(subjects)
    }

    if (isGeInstructor) {
      return res.json(await pooledSubjects(isGeneralEd, semester))
    }
    if (isPathfitInstructor) {
      return res.json(await pooledSubjects(isPathfit, semester))
    }
    if (isNstpInstructor) {
      return res.json(await pooledSubjects(isNstp, semester))
    }

    res.json(await departmentSubjects(req.user.department, semester))
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/prospectus/:id/subjects
router.get('/:id/subjects', authenticate, async (req, res) => {
  try {
    const [subjects] = await pool.query(
      'SELECT * FROM prospectus_subjects WHERE prospectus_id = ? ORDER BY year_level, semester, id',
      [req.params.id]
    )
    res.json(subjects)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/prospectus  — chair imports a prospectus (subjects parsed on client)
router.post('/', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { program, academic_year, filename, subjects } = req.body

  if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
    return res.status(400).json({ message: 'No subjects provided.' })
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [pResult] = await conn.query(
      'INSERT INTO prospectus (program, academic_year, filename, uploaded_by) VALUES (?, ?, ?, ?)',
      [program || 'BSIT', academic_year || null, filename || null, req.user.id]
    )
    const prospectusId = pResult.insertId

    const rows = subjects.map(s => [
      prospectusId,
      s.course_code,
      s.descriptive_title,
      s.units || 0,
      s.lec_hours || 0,
      s.lab_hours || 0,
      s.year_level,
      s.semester,
      s.prerequisite || null,
    ])

    await conn.query(
      `INSERT INTO prospectus_subjects
        (prospectus_id, course_code, descriptive_title, units, lec_hours, lab_hours, year_level, semester, prerequisite)
       VALUES ?`,
      [rows]
    )

    await conn.commit()
    res.status(201).json({ message: 'Prospectus imported successfully.', prospectus_id: prospectusId, count: subjects.length })
  } catch (err) {
    await conn.rollback()
    res.status(500).json({ message: 'Failed to import prospectus.', error: err.message })
  } finally {
    conn.release()
  }
})

// DELETE /api/prospectus/:id  — admin or owner chair can delete
router.delete('/:id', authenticate, authorize('chair', 'admin'), async (req, res) => {
  try {
    const isChair = req.user.role === 'chair'
    const whereExtra = isChair ? 'AND uploaded_by = ?' : ''
    const params = isChair ? [req.params.id, req.user.id] : [req.params.id]
    const [result] = await pool.query(
      `DELETE FROM prospectus WHERE id = ? ${whereExtra}`,
      params
    )
    if (result.affectedRows === 0) {
      return res.status(403).json({ message: 'Not found or not authorized.' })
    }
    res.json({ message: 'Prospectus deleted.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/prospectus/specialties/me  — instructor gets their saved specialties
router.get('/specialties/me', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT subject_id FROM instructor_specialties WHERE instructor_id = ?',
      [req.user.id]
    )
    res.json(rows.map(r => r.subject_id))
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/prospectus/specialties/me  — instructor (or a Chair/Dean who also
// teaches) saves their specialties
router.put('/specialties/me', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  const { subject_ids } = req.body
  if (!Array.isArray(subject_ids)) {
    return res.status(400).json({ message: 'subject_ids must be an array.' })
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM instructor_specialties WHERE instructor_id = ?', [req.user.id])
    if (subject_ids.length > 0) {
      const rows = subject_ids.map(id => [req.user.id, id])
      await conn.query(
        'INSERT IGNORE INTO instructor_specialties (instructor_id, subject_id) VALUES ?',
        [rows]
      )
    }
    await conn.commit()
    res.json({ message: 'Specialties saved.', count: subject_ids.length })
  } catch (err) {
    await conn.rollback()
    res.status(500).json({ message: 'Server error.', error: err.message })
  } finally {
    conn.release()
  }
})

// GET /api/prospectus/specialties/peers?semester=1  — for each subject the
// calling instructor currently sees, which OTHER instructors have also
// chosen it as their specialty. Matched by course code (not raw subject_id)
// so it still works for GE/PATHFIT/NSTP instructors, whose visible subjects
// are a deduped pool spanning several departments' own copies of the course.
router.get('/specialties/peers', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  const { semester } = req.query
  try {
    let mySubjects
    if (req.user.department === 'General Education') {
      mySubjects = await pooledSubjects(isGeneralEd, semester)
    } else if (req.user.department === 'PATHFIT') {
      mySubjects = await pooledSubjects(isPathfit, semester)
    } else if (req.user.department === 'NSTP') {
      mySubjects = await pooledSubjects(isNstp, semester)
    } else {
      mySubjects = await departmentSubjects(req.user.department, semester)
    }
    if (!mySubjects.length) return res.json({})

    const codes = [...new Set(mySubjects.map(s => s.course_code.trim().toUpperCase()))]
    const [peerRows] = await pool.query(`
      SELECT DISTINCT ps.course_code, u.id AS instructor_id, u.name AS instructor_name
      FROM instructor_specialties isp
      JOIN prospectus_subjects ps ON isp.subject_id = ps.id
      JOIN users u ON isp.instructor_id = u.id
      WHERE UPPER(TRIM(ps.course_code)) IN (${codes.map(() => '?').join(',')})
        AND isp.instructor_id != ?
    `, [...codes, req.user.id])

    const byCode = {}
    for (const r of peerRows) {
      const key = r.course_code.trim().toUpperCase()
      if (!byCode[key]) byCode[key] = []
      byCode[key].push({ id: r.instructor_id, name: r.instructor_name })
    }

    const result = {}
    for (const s of mySubjects) {
      result[s.id] = byCode[s.course_code.trim().toUpperCase()] || []
    }
    res.json(result)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET /api/prospectus/specialties/instructor/:id  — chair/admin views an instructor's specialties
router.get('/specialties/instructor/:id', authenticate, authorize('chair', 'admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ps.*, isp.created_at AS selected_at
      FROM instructor_specialties isp
      JOIN prospectus_subjects ps ON isp.subject_id = ps.id
      WHERE isp.instructor_id = ?
      ORDER BY ps.year_level, ps.semester
    `, [req.params.id])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

export default router
