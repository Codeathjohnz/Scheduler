import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { generateFacultyLoadingDocx } from '../utils/facultyLoadingDocx.js'

const router = Router()

// While a submission is still at the instructor-confirmation stage, an
// instructor newly assigned (or reassigned) to a subject needs to be pulled
// into that same confirmation set — otherwise their load would be silently
// excluded from the whole approval chain until the submission either
// finishes or gets returned and resubmitted from scratch.
async function syncConfirmation(chairId, academicYear, semester, instructorId) {
  if (!instructorId) return
  const [[sub]] = await pool.query(
    `SELECT id FROM submissions WHERE chair_id = ? AND academic_year = ? AND semester = ? AND status = 'pending_instructor'`,
    [chairId, academicYear, semester]
  )
  if (!sub) return
  await pool.query(
    'INSERT IGNORE INTO submission_confirmations (submission_id, instructor_id) VALUES (?, ?)',
    [sub.id, instructorId]
  )
}

// Auto-generate load-balancing policy: fill everyone up to the standard 21
// UNIT CREDIT load first; only overflow an instructor past that (up to the 27
// unit-credit hard cap) once nobody else has room within the standard load.
// This is Unit Credit (Lec + Lab×0.75), not the nominal "Units" column —
// matches the same formula used on the Faculty Loading Sheet (unitCredit() in
// client/src/pages/chair/FacultyLoad.jsx).
const TARGET_UNITS = 21
export const MAX_UNITS = 27

function unitCredit(lecHours, labHours) {
  return Number(lecHours || 0) + Number(labHours || 0) * 0.75
}

// Four disjoint instructor pools: General Education ("GE" prefix), PATHFIT
// ("PATHFIT" prefix), NSTP ("NSTP" prefix — with or without a trailing
// number, since some prospectuses code it as bare "NSTP"), and major/
// department subjects, which may only go to instructors from the department
// that owns the prospectus. A subject in one pool may only be taught by an
// instructor from that same pool's department — never mixed.
function isGeneralEd(courseCode) {
  return /^GE\b/i.test(String(courseCode || '').trim())
}
function isPathfit(courseCode) {
  return /^PATHFIT\b/i.test(String(courseCode || '').trim())
}
function isNstp(courseCode) {
  return /^NSTP\b/i.test(String(courseCode || '').trim())
}

// An instructor's total load for the cap = teaching unit credit (faculty_load_entries,
// Lec + Lab×0.75) PLUS any approved administrative/research/extension/project load
// (faculty_admin_loads — a flat unit value, already equivalent to unit credit since
// those entries have no lec/lab hours) — the 21/27 cap must reflect their whole
// unit-credit load, not just what's being taught, and not the nominal units count.
async function getOtherLoadMap(academic_year, semester) {
  const [rows] = await pool.query(
    `SELECT instructor_id, SUM(units) AS total_units FROM faculty_admin_loads
     WHERE academic_year=? AND semester=? GROUP BY instructor_id`,
    [academic_year, semester]
  )
  const map = {}
  rows.forEach(r => { map[r.instructor_id] = Number(r.total_units) })
  return map
}

// NSTP does not count toward an instructor's unit-credit load (it's carried
// on the record and still shown on the Faculty Loading Sheet, but excluded
// from the 21/27 cap and every "load" total) — same NSTP/PATHFIT/GE prefix
// convention used everywhere else in this file.
export async function getCombinedLoadMap(academic_year, semester) {
  const [teachRows] = await pool.query(
    `SELECT assigned_instructor_id AS instructor_id, lec_hours, lab_hours, course_code
     FROM faculty_load_entries
     WHERE academic_year=? AND semester=? AND assigned_instructor_id IS NOT NULL`,
    [academic_year, semester]
  )
  const map = {}
  for (const r of teachRows) {
    if (isNstp(r.course_code)) continue
    map[r.instructor_id] = (map[r.instructor_id] || 0) + unitCredit(r.lec_hours, r.lab_hours)
  }
  const otherMap = await getOtherLoadMap(academic_year, semester)
  for (const [id, units] of Object.entries(otherMap)) {
    map[id] = (map[id] || 0) + units
  }
  return map
}

// GET /api/faculty-load/section-counts?year=&semester=  — { [year_level]: section_count }
router.get('/section-counts', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [rows] = await pool.query(
      'SELECT year_level, section_count FROM section_counts WHERE chair_id = ? AND academic_year = ? AND semester = ?',
      [req.user.id, year, semester]
    )
    const counts = {}
    for (const r of rows) counts[r.year_level] = r.section_count
    res.json(counts)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/faculty-load/section-counts  — body: { academic_year, semester, counts: {1:2,2:4,3:1,4:1} }
router.put('/section-counts', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { academic_year, semester, counts } = req.body
  if (!academic_year || !semester || !counts || typeof counts !== 'object') {
    return res.status(400).json({ message: 'academic_year, semester, and counts are required.' })
  }
  try {
    const rows = Object.entries(counts)
      .map(([yearLevel, count]) => [req.user.id, academic_year, semester, Number(yearLevel), Math.max(1, Math.min(26, Number(count) || 1))])
    if (rows.length) {
      await pool.query(
        `INSERT INTO section_counts (chair_id, academic_year, semester, year_level, section_count)
         VALUES ? ON DUPLICATE KEY UPDATE section_count = VALUES(section_count)`,
        [rows]
      )
    }
    res.json({ message: 'Section counts saved.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/faculty-load?year=2026-2027&semester=1
router.get('/', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  const isChair = req.user.role === 'chair'
  try {
    const entriesParams = isChair ? [year, semester, req.user.id] : [year, semester]
    const [entries] = await pool.query(`
      SELECT fle.*,
        u.name AS instructor_name,
        u.department AS instructor_dept,
        ps.prerequisite
      FROM faculty_load_entries fle
      LEFT JOIN users u ON fle.assigned_instructor_id = u.id
      LEFT JOIN prospectus_subjects ps ON fle.subject_id = ps.id
      WHERE fle.academic_year = ? AND fle.semester = ?
        ${isChair ? 'AND fle.chair_id = ?' : ''}
      ORDER BY u.name, fle.sort_order, fle.id
    `, entriesParams)

    const adminParams = isChair ? [year, semester, req.user.id] : [year, semester]
    const [adminLoads] = await pool.query(`
      SELECT fal.*, u.name AS instructor_name
      FROM faculty_admin_loads fal
      JOIN users u ON fal.instructor_id = u.id
      WHERE fal.academic_year = ? AND fal.semester = ?
        ${isChair ? 'AND fal.chair_id = ?' : ''}
    `, adminParams)

    res.json({ entries, adminLoads })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/faculty-load/my-load?year=&semester=  — the calling instructor's
// own Individual Faculty Load (IFL): every subject assigned to them across
// EVERY chair they teach for (not just one department/program — a CCIS
// instructor teaching both a BSIT and a BSIS subject sees both here), plus
// their own administrative/research/extension/project load. Open to any role
// that can be assigned teaching load (instructor, and chairs/deans who also
// teach, matching the specialties/confirm-load routes' authorize list).
router.get('/my-load', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [entries] = await pool.query(`
      SELECT fle.*,
        chair.name AS chair_name, chair.department AS chair_dept,
        ps.prerequisite
      FROM faculty_load_entries fle
      LEFT JOIN users chair ON fle.chair_id = chair.id
      LEFT JOIN prospectus_subjects ps ON fle.subject_id = ps.id
      WHERE fle.academic_year = ? AND fle.semester = ? AND fle.assigned_instructor_id = ?
      ORDER BY fle.sort_order, fle.id
    `, [year, semester, req.user.id])

    const [adminLoads] = await pool.query(`
      SELECT fal.* FROM faculty_admin_loads fal
      WHERE fal.academic_year = ? AND fal.semester = ? AND fal.instructor_id = ?
    `, [year, semester, req.user.id])

    res.json({ entries, adminLoads })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/faculty-load/export-docx?year=&semester=&collegeName=&programName=
// Official Faculty Loading form (F-REG-010), one instructor block per
// assigned instructor, filled from this term's faculty_load_entries +
// faculty_admin_loads. Chairs export their own department; admin may pass
// chair_id to export any department's.
router.get('/export-docx', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1, collegeName, programName, chair_id } = req.query
  const chairId = req.user.role === 'admin' && chair_id ? Number(chair_id) : req.user.id
  try {
    const buffer = await generateFacultyLoadingDocx({
      chairId, academicYear: year, semester: Number(semester), collegeName, programName,
    })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="FacultyLoading_${year}_Sem${semester}.docx"`)
    res.send(buffer)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

// GET /api/faculty-load/instructors/:subjectId — smart suggestions
router.get('/instructors/:subjectId', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    // Current total unit load per instructor (teaching + approved other load)
    const loadMap = await getCombinedLoadMap(year, semester)

    const [[subject]] = await pool.query('SELECT course_code FROM prospectus_subjects WHERE id = ?', [req.params.subjectId])
    const requiredDept = isGeneralEd(subject?.course_code) ? 'General Education'
      : isPathfit(subject?.course_code) ? 'PATHFIT'
      : isNstp(subject?.course_code) ? 'NSTP'
      : null

    // GE subjects only show GE instructors, PATHFIT subjects only show PATHFIT
    // instructors, NSTP subjects only show NSTP instructors, and major
    // subjects only show instructors from the chair's own department — plus
    // anyone from another department who explicitly selected this exact
    // subject as their specialty (e.g. covering overflow).
    let deptCondition, deptParams
    if (requiredDept) {
      deptCondition = 'u.department = ?'
      deptParams = [requiredDept]
    } else {
      const [[me]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
      deptCondition = `(u.department = ? OR EXISTS (
        SELECT 1 FROM instructor_specialties isp2
        WHERE isp2.instructor_id = u.id AND isp2.subject_id = ?
      ))`
      deptParams = [me?.department, req.params.subjectId]
    }

    const [instructors] = await pool.query(`
      SELECT u.id, u.name, u.department, u.role,
        (SELECT COUNT(*) FROM instructor_specialties isp
         WHERE isp.instructor_id = u.id AND isp.subject_id = ?) AS has_specialty,
        (u.department = 'General Education') AS is_ge,
        (u.department = 'PATHFIT') AS is_pathfit,
        (u.department = 'NSTP') AS is_nstp
      FROM users u
      WHERE u.role IN ('instructor', 'chair', 'dean') AND ${deptCondition}
      ORDER BY has_specialty DESC, u.name ASC
    `, [req.params.subjectId, ...deptParams])

    const result = instructors.map(i => ({
      ...i,
      current_units: loadMap[i.id] || 0,
      has_specialty: i.has_specialty > 0,
    }))

    res.json(result)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/faculty-load/instructors-all — all instructors with current load
router.get('/instructors-all', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const loadMap = await getCombinedLoadMap(year, semester)

    const [instructors] = await pool.query(
      "SELECT id, name, department, role, (department = 'General Education') AS is_ge, (department = 'PATHFIT') AS is_pathfit, (department = 'NSTP') AS is_nstp FROM users WHERE role IN ('instructor', 'chair', 'dean') ORDER BY department, name"
    )
    res.json(instructors.map(i => ({ ...i, current_units: loadMap[i.id] || 0 })))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/faculty-load — a subject must exist in the uploaded prospectus;
// course_code/descriptive_title/units/lec_hours/lab_hours are always derived
// server-side from that prospectus row, never trusted from the client.
router.post('/', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { academic_year, semester, program_yr_sec, year_level, assigned_instructor_id, room, subject_id } = req.body
  if (!subject_id) {
    return res.status(400).json({ message: 'Please select a subject from the uploaded prospectus.' })
  }
  try {
    const [[subject]] = await pool.query('SELECT * FROM prospectus_subjects WHERE id = ?', [subject_id])
    if (!subject) {
      return res.status(400).json({ message: 'That subject was not found in the uploaded prospectus.' })
    }
    const [r] = await pool.query(`
      INSERT INTO faculty_load_entries
        (academic_year, semester, course_code, descriptive_title, program_yr_sec, year_level, units, lec_hours, lab_hours, assigned_instructor_id, room, subject_id, chair_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [academic_year, semester, subject.course_code, subject.descriptive_title, program_yr_sec, year_level || null,
        subject.units, subject.lec_hours, subject.lab_hours, assigned_instructor_id || null, room || null, subject_id, req.user.id])
    await syncConfirmation(req.user.id, academic_year, semester, assigned_instructor_id)
    res.status(201).json({ id: r.insertId })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/faculty-load/:id — if subject_id is provided, it must exist in the
// prospectus and the course identity is re-derived from it. If subject_id is
// absent (e.g. an inline edit of just Section/Room on a legacy entry with no
// prospectus link), the existing course identity is left untouched.
router.put('/:id', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { program_yr_sec, year_level, assigned_instructor_id, room, subject_id } = req.body
  try {
    if (subject_id) {
      const [[subject]] = await pool.query('SELECT * FROM prospectus_subjects WHERE id = ?', [subject_id])
      if (!subject) {
        return res.status(400).json({ message: 'That subject was not found in the uploaded prospectus.' })
      }
      await pool.query(`
        UPDATE faculty_load_entries SET
          course_code=?, descriptive_title=?, program_yr_sec=?, year_level=?, units=?, lec_hours=?, lab_hours=?,
          assigned_instructor_id=?, room=?, subject_id=?
        WHERE id=?
      `, [subject.course_code, subject.descriptive_title, program_yr_sec, year_level || null,
          subject.units, subject.lec_hours, subject.lab_hours, assigned_instructor_id || null, room || null, subject_id, req.params.id])
    } else {
      await pool.query(`
        UPDATE faculty_load_entries SET
          program_yr_sec=?, year_level=?, assigned_instructor_id=?, room=?
        WHERE id=?
      `, [program_yr_sec, year_level || null, assigned_instructor_id || null, room || null, req.params.id])
    }
    const [[entry]] = await pool.query(
      'SELECT chair_id, academic_year, semester, assigned_instructor_id FROM faculty_load_entries WHERE id=?',
      [req.params.id]
    )
    if (entry) await syncConfirmation(entry.chair_id, entry.academic_year, entry.semester, entry.assigned_instructor_id)
    res.json({ message: 'Updated.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /api/faculty-load/:id
router.delete('/:id', authenticate, authorize('chair', 'admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM faculty_load_entries WHERE id=?', [req.params.id])
    res.json({ message: 'Deleted.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

const VALID_LOAD_TYPES = new Set(['administrative', 'research', 'extension', 'project'])

// POST /api/faculty-load/admin-load — also covers research/extension/project load
router.post('/admin-load', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { instructor_id, academic_year, semester, description, units, lec_hours, lab_hours, load_type } = req.body
  if (!description || !String(description).trim()) {
    return res.status(400).json({ message: 'Title is required.' })
  }
  if (!units || Number(units) <= 0) {
    return res.status(400).json({ message: 'Unit credit is required.' })
  }
  const type = VALID_LOAD_TYPES.has(load_type) ? load_type : 'administrative'
  try {
    const [r] = await pool.query(`
      INSERT INTO faculty_admin_loads (instructor_id, academic_year, semester, description, units, lec_hours, lab_hours, load_type, chair_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [instructor_id, academic_year, semester, description.trim(), units, lec_hours || 0, lab_hours || 0, type, req.user.id])
    res.status(201).json({ id: r.insertId })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /api/faculty-load/admin-load/:id
router.delete('/admin-load/:id', authenticate, authorize('chair', 'admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM faculty_admin_loads WHERE id=?', [req.params.id])
    res.json({ message: 'Deleted.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/faculty-load/auto-generate
router.post('/auto-generate', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { academic_year, semester, prospectus_id, clear_existing } = req.body
  try {
    // Get the chair's department so we only assign instructors from same dept
    const [[chair]] = await pool.query('SELECT department FROM users WHERE id=?', [req.user.id])
    const dept = chair?.department

    // Get subjects to assign
    let subjects
    if (prospectus_id) {
      const [rows] = await pool.query(
        'SELECT * FROM prospectus_subjects WHERE prospectus_id=? ORDER BY year_level, semester, id',
        [prospectus_id]
      )
      subjects = rows
    } else {
      // No prospectus specified — use the CALLING CHAIR's own latest
      // prospectus, never the globally latest one across the whole
      // university (a different department uploading more recently must
      // never leak their curriculum into this chair's faculty load).
      const [rows] = await pool.query(`
        SELECT ps.* FROM prospectus_subjects ps
        JOIN prospectus p ON ps.prospectus_id = p.id
        WHERE p.uploaded_by = ?
        ORDER BY p.created_at DESC, ps.year_level, ps.semester, ps.id
      `, [req.user.id])
      // Only take subjects from the chair's single latest prospectus
      const latestId = rows[0]?.prospectus_id
      subjects = rows.filter(r => r.prospectus_id === latestId)
    }

    // Only generate entries for the selected term's semester
    subjects = subjects.filter(s => Number(s.semester) === Number(semester))

    if (!subjects.length) {
      return res.status(400).json({ message: `No ${['','1st','2nd','Summer'][semester] || ''} Semester subjects found in the selected prospectus.` })
    }

    // Program name (for auto-labeling sections, e.g. "BSIT")
    let program = 'BSIT'
    {
      const progId = prospectus_id || subjects[0]?.prospectus_id
      if (progId) {
        const [[p]] = await pool.query('SELECT program FROM prospectus WHERE id=?', [progId])
        if (p?.program) program = p.program
      }
    }

    // Sections configured per year level for this term (opt-in — year levels with
    // no configured count keep the legacy single, unlabeled entry per subject)
    const [countRows] = await pool.query(
      'SELECT year_level, section_count FROM section_counts WHERE chair_id=? AND academic_year=? AND semester=?',
      [req.user.id, academic_year, semester]
    )
    const sectionCountMap = {}
    for (const r of countRows) sectionCountMap[r.year_level] = r.section_count
    const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    // Expand each subject into one entry per configured section, e.g. 4 sections → A, B, C, D
    const expandedSubjects = []
    for (const sub of subjects) {
      const count = sectionCountMap[sub.year_level]
      if (!count) {
        expandedSubjects.push({ ...sub, program_yr_sec: '' })
      } else {
        for (let i = 0; i < count; i++) {
          expandedSubjects.push({ ...sub, program_yr_sec: `${program} ${sub.year_level}${SECTION_LETTERS[i] || i + 1}` })
        }
      }
    }

    // Get instructors from the chair's department, plus General Education,
    // PATHFIT, and NSTP (all always included — every program's curriculum
    // includes their subjects)
    const deptFilter = dept
      ? "AND (u.department = ? OR u.department = 'General Education' OR u.department = 'PATHFIT' OR u.department = 'NSTP')"
      : ''
    const deptParam = dept ? [dept] : []
    const [instructors] = await pool.query(`
      SELECT u.id, u.name, u.department,
        GROUP_CONCAT(isp.subject_id) AS specialty_ids
      FROM users u
      LEFT JOIN instructor_specialties isp ON isp.instructor_id = u.id
      WHERE u.role IN ('instructor', 'chair', 'dean') ${deptFilter}
      GROUP BY u.id
      ORDER BY u.name
    `, deptParam)

    // Current total unit loads for this term (running tally — updated as we assign).
    // Starts from teaching units PLUS any approved administrative/research/
    // extension/project load, so the 21/27 cap reflects an instructor's whole
    // load, not just what's being taught.
    const otherLoadMap = await getOtherLoadMap(academic_year, semester)
    const loadMap = await getCombinedLoadMap(academic_year, semester)

    // Build map: subject_id → [instructor_id, ...]
    const specialtyMap = {}
    for (const inst of instructors) {
      const ids = inst.specialty_ids ? inst.specialty_ids.split(',').map(Number) : []
      for (const sid of ids) {
        if (!specialtyMap[sid]) specialtyMap[sid] = []
        specialtyMap[sid].push(inst.id)
      }
    }
    // Partition the pool so GE subjects only draw from GE instructors,
    // PATHFIT subjects only draw from PATHFIT instructors, NSTP subjects
    // only draw from NSTP instructors, and major subjects only draw from
    // department instructors — never mixed.
    const geInstructorIds      = instructors.filter(i => i.department === 'General Education').map(i => i.id)
    const pathfitInstructorIds = instructors.filter(i => i.department === 'PATHFIT').map(i => i.id)
    const nstpInstructorIds    = instructors.filter(i => i.department === 'NSTP').map(i => i.id)
    const majorInstructorIds   = instructors.filter(i =>
      i.department !== 'General Education' && i.department !== 'PATHFIT' && i.department !== 'NSTP'
    ).map(i => i.id)

    // Clear existing entries first if requested
    let existingMap = new Map()
    if (clear_existing) {
      await pool.query(
        'DELETE FROM faculty_load_entries WHERE academic_year=? AND semester=? AND chair_id=?',
        [academic_year, semester, req.user.id]
      )
      // Reset the teaching portion, but keep each instructor's approved
      // administrative/research/extension/project load — that isn't touched
      // by this delete, so it still counts toward the cap.
      Object.keys(loadMap).forEach(k => { delete loadMap[k] })
      Object.assign(loadMap, otherLoadMap)
    } else {
      // Safe to re-run: match against what's already there (by subject +
      // section) instead of blindly inserting a duplicate batch. An
      // already-assigned entry is left untouched; an unassigned one is a
      // candidate to fill now — e.g. an instructor added a specialty after
      // the first run and is only now eligible for a subject that was
      // generated but left unassigned.
      const [existingRows] = await pool.query(
        'SELECT id, subject_id, program_yr_sec, assigned_instructor_id FROM faculty_load_entries WHERE academic_year=? AND semester=? AND chair_id=?',
        [academic_year, semester, req.user.id]
      )
      for (const e of existingRows) existingMap.set(`${e.subject_id}|${e.program_yr_sec}`, e)
    }

    // Pick the least-loaded eligible instructor, preferring one that stays within
    // TARGET_UNITS unit credit; reach into the MAX_UNITS overflow zone if nobody
    // has room within the standard load. If a subject has a specialist but even
    // the least-loaded one is already past MAX_UNITS, assign them anyway rather
    // than leaving a specialized subject unassigned — the chair sees this as a
    // visible overload on their card and can rebalance (unassign a subject,
    // reduce their other load, or add a second specialist) before submitting.
    // Only returns null when there is no specialist at all to assign.
    function pickInstructor(candidateIds, subjectCredit) {
      const sorted = [...new Set(candidateIds)].sort((a, b) => (loadMap[a] || 0) - (loadMap[b] || 0))
      return sorted.find(id => (loadMap[id] || 0) + subjectCredit <= TARGET_UNITS)
          ?? sorted.find(id => (loadMap[id] || 0) + subjectCredit <= MAX_UNITS)
          ?? sorted[0]
          ?? null
    }

    // Generate entries — one per subject per configured section. Only instructors
    // who selected the subject as their specialty are ever assigned; a subject
    // with no specialist is left unassigned for the chair to assign manually,
    // rather than falling back to a non-specialist just to balance units. GE
    // subjects only draw from GE instructors, PATHFIT subjects only draw from
    // PATHFIT instructors, NSTP subjects only draw from NSTP instructors, and
    // major subjects only draw from department instructors.
    const rows = []
    const toFill = []   // [assignedId, entryId] — existing unassigned entries now filled
    let alreadyAssignedCount = 0
    let stillUnassignedCount = 0
    for (const sub of expandedSubjects) {
      const existing = existingMap.get(`${sub.id}|${sub.program_yr_sec}`)
      if (existing?.assigned_instructor_id) {
        alreadyAssignedCount++
        continue
      }

      const subjectCredit = unitCredit(sub.lec_hours, sub.lab_hours)
      const isNstpSubject = isNstp(sub.course_code)
      const eligiblePool = isGeneralEd(sub.course_code) ? geInstructorIds
        : isPathfit(sub.course_code) ? pathfitInstructorIds
        : isNstpSubject ? nstpInstructorIds
        : majorInstructorIds
      const specialists = (specialtyMap[sub.id] || []).filter(id => eligiblePool.includes(id))
      const assignedId = pickInstructor(specialists, subjectCredit)
      // NSTP does not count toward the unit-credit cap — see getCombinedLoadMap.
      if (assignedId && !isNstpSubject) loadMap[assignedId] = (loadMap[assignedId] || 0) + subjectCredit

      if (existing) {
        if (assignedId) toFill.push([assignedId, existing.id])
        else stillUnassignedCount++
        continue
      }

      rows.push([
        academic_year, semester,
        sub.course_code, sub.descriptive_title,
        sub.program_yr_sec,
        sub.year_level || null,
        sub.units, sub.lec_hours, sub.lab_hours,
        assignedId, null, sub.id, req.user.id
      ])
    }

    if (rows.length) {
      await pool.query(`
        INSERT INTO faculty_load_entries
          (academic_year, semester, course_code, descriptive_title, program_yr_sec, year_level,
           units, lec_hours, lab_hours, assigned_instructor_id, room, subject_id, chair_id)
        VALUES ?
      `, [rows])
    }
    for (const [assignedId, entryId] of toFill) {
      await pool.query('UPDATE faculty_load_entries SET assigned_instructor_id=? WHERE id=?', [assignedId, entryId])
    }

    const newlyAssignedIds = [...new Set([...rows.map(r => r[9]), ...toFill.map(f => f[0])].filter(Boolean))]
    for (const id of newlyAssignedIds) {
      await syncConfirmation(req.user.id, academic_year, semester, id)
    }

    const newlyAssignedCount = rows.filter(r => r[9] !== null).length + toFill.length
    const newlyInsertedUnassignedCount = rows.filter(r => r[9] === null).length
    const assigned = newlyAssignedCount + alreadyAssignedCount
    const unassigned = newlyInsertedUnassignedCount + stillUnassignedCount
    res.json({ count: assigned + unassigned, assigned, unassigned, dept })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
