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
export async function syncConfirmation(chairId, academicYear, semester, instructorId) {
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
export const TARGET_UNITS = 21
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

// ── Teaching for ANOTHER department ─────────────────────────────────────────
// A chair can't simply assign an instructor from a different department: that
// person has their own department's students. Instead the chair sends a
// request (see routes/crossDept.js) — the subject stays UNASSIGNED, so it
// counts toward nobody's load and doesn't reach the schedule, until the
// instructor accepts AND their home chair/dean approves. The shared GE, PATHFIT
// and NSTP pools are exempt: every department draws on them by design.
const POOL_DEPARTMENTS = new Set(['General Education', 'PATHFIT', 'NSTP'])

// Returns the instructor (with id/name/department/cross_dept_open) if assigning
// them would cross departments for this chair, otherwise null.
async function crossDeptTarget(chairId, actorRole, instructorId) {
  if (!instructorId || actorRole !== 'chair') return null
  const [[chair]] = await pool.query('SELECT department FROM users WHERE id = ?', [chairId])
  const [[inst]] = await pool.query(
    'SELECT id, name, department, role, cross_dept_open FROM users WHERE id = ?', [instructorId]
  )
  if (!chair || !inst || !inst.department) return null
  if (inst.department === chair.department || POOL_DEPARTMENTS.has(inst.department)) return null
  return inst
}

// Message if the request can't be made, otherwise null: the instructor must be
// open to other departments (or have picked this exact subject as a
// specialty), and this subject must not push them past the hard unit cap.
async function crossDeptProblem(inst, subjectId, year, semester, credit) {
  const [[spec]] = subjectId
    ? await pool.query('SELECT COUNT(*) AS n FROM instructor_specialties WHERE instructor_id = ? AND subject_id = ?', [inst.id, subjectId])
    : [[{ n: 0 }]]
  if (!inst.cross_dept_open && !spec.n) {
    return `${inst.name} hasn't said they're open to teaching for other departments.`
  }
  const load = (await getCombinedLoadMap(year, semester))[inst.id] || 0
  if (load + credit > MAX_UNITS) {
    return `${inst.name} is already at ${load.toFixed(2)} units — this ${credit.toFixed(2)}-unit subject would put them over the ${MAX_UNITS}-unit cap.`
  }
  return null
}

async function cancelOpenCrossDeptRequests(entryId) {
  await pool.query(
    "UPDATE cross_dept_requests SET status = 'cancelled' WHERE entry_id = ? AND status IN ('pending_instructor', 'pending_home')",
    [entryId]
  )
}

async function createCrossDeptRequest(entryId, instructorId, chairId, note) {
  await cancelOpenCrossDeptRequests(entryId)
  await pool.query(
    'INSERT INTO cross_dept_requests (entry_id, instructor_id, requested_by, note) VALUES (?, ?, ?, ?)',
    [entryId, instructorId, chairId, note ? String(note).slice(0, 255) : null]
  )
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
        ps.prerequisite,
        (SELECT r.status FROM cross_dept_requests r WHERE r.entry_id = fle.id AND r.status IN ('pending_instructor','pending_home','declined') ORDER BY r.id DESC LIMIT 1) AS request_status,
        (SELECT ri.name FROM cross_dept_requests r JOIN users ri ON ri.id = r.instructor_id WHERE r.entry_id = fle.id AND r.status IN ('pending_instructor','pending_home','declined') ORDER BY r.id DESC LIMIT 1) AS request_instructor,
        (SELECT r.declined_stage FROM cross_dept_requests r WHERE r.entry_id = fle.id AND r.status IN ('pending_instructor','pending_home','declined') ORDER BY r.id DESC LIMIT 1) AS request_declined_stage,
        (SELECT r.decline_reason FROM cross_dept_requests r WHERE r.entry_id = fle.id AND r.status IN ('pending_instructor','pending_home','declined') ORDER BY r.id DESC LIMIT 1) AS request_decline_reason
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
    // Instructors from OTHER departments who said they're open to it (My
    // Specialty) are listed too, flagged cross_dept — picking one sends them a
    // request rather than assigning directly.
    const [[me]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    let deptCondition, deptParams
    if (requiredDept) {
      deptCondition = 'u.department = ?'
      deptParams = [requiredDept]
    } else {
      deptCondition = `(u.department = ? OR EXISTS (
        SELECT 1 FROM instructor_specialties isp2
        WHERE isp2.instructor_id = u.id AND isp2.subject_id = ?
      ) OR (u.cross_dept_open = 1 AND u.department IS NOT NULL
            AND u.department NOT IN ('General Education', 'PATHFIT', 'NSTP')))`
      deptParams = [me?.department, req.params.subjectId]
    }

    const [instructors] = await pool.query(`
      SELECT u.id, u.name, u.department, u.role,
        (SELECT COUNT(*) FROM instructor_specialties isp
         WHERE isp.instructor_id = u.id AND isp.subject_id = ?) AS has_specialty,
        (SELECT MIN(isp3.priority) FROM instructor_specialties isp3
         WHERE isp3.instructor_id = u.id AND isp3.subject_id = ?) AS specialty_priority,
        (SELECT SUBSTRING_INDEX(GROUP_CONCAT(ps5.descriptive_title ORDER BY isp5.priority, ps5.id SEPARATOR '; '), '; ', 3)
         FROM instructor_specialties isp5 JOIN prospectus_subjects ps5 ON ps5.id = isp5.subject_id
         WHERE isp5.instructor_id = u.id) AS specialty_summary,
        (u.department = 'General Education') AS is_ge,
        (u.department = 'PATHFIT') AS is_pathfit,
        (u.department = 'NSTP') AS is_nstp
      FROM users u
      WHERE u.role IN ('instructor', 'chair', 'dean') AND ${deptCondition}
      ORDER BY has_specialty DESC, specialty_priority ASC, u.name ASC
    `, [req.params.subjectId, req.params.subjectId, ...deptParams])

    const result = instructors.map(i => ({
      ...i,
      current_units: loadMap[i.id] || 0,
      has_specialty: i.has_specialty > 0,
      cross_dept: !requiredDept && !!me?.department && i.department !== me.department
        && !['General Education', 'PATHFIT', 'NSTP'].includes(i.department),
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
  const { academic_year, semester, program_yr_sec, year_level, assigned_instructor_id, room, subject_id, request_note } = req.body
  if (!subject_id) {
    return res.status(400).json({ message: 'Please select a subject from the uploaded prospectus.' })
  }
  try {
    const [[subject]] = await pool.query('SELECT * FROM prospectus_subjects WHERE id = ?', [subject_id])
    if (!subject) {
      return res.status(400).json({ message: 'That subject was not found in the uploaded prospectus.' })
    }
    // Another department's instructor → send a request instead of assigning.
    const cross = await crossDeptTarget(req.user.id, req.user.role, assigned_instructor_id)
    if (cross) {
      const problem = await crossDeptProblem(cross, subject_id, academic_year, semester, unitCredit(subject.lec_hours, subject.lab_hours))
      if (problem) return res.status(400).json({ message: problem })
    }
    const [r] = await pool.query(`
      INSERT INTO faculty_load_entries
        (academic_year, semester, course_code, descriptive_title, program_yr_sec, year_level, units, lec_hours, lab_hours, assigned_instructor_id, room, subject_id, chair_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [academic_year, semester, subject.course_code, subject.descriptive_title, program_yr_sec, year_level || null,
        subject.units, subject.lec_hours, subject.lab_hours, cross ? null : (assigned_instructor_id || null), room || null, subject_id, req.user.id])
    if (cross) {
      await createCrossDeptRequest(r.insertId, cross.id, req.user.id, request_note)
      return res.status(201).json({ id: r.insertId, pending_request: true, instructor_name: cross.name })
    }
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
  const { program_yr_sec, year_level, assigned_instructor_id, room, subject_id, request_note } = req.body
  try {
    // Only when the instructor is actually being CHANGED: an inline edit of
    // Section/Room re-sends the current (or still-unassigned) value untouched.
    const [[before]] = await pool.query(
      'SELECT assigned_instructor_id, subject_id, lec_hours, lab_hours, academic_year, semester FROM faculty_load_entries WHERE id = ?',
      [req.params.id]
    )
    if (!before) return res.status(404).json({ message: 'Entry not found.' })
    const instructorChanged = Number(assigned_instructor_id || 0) !== Number(before.assigned_instructor_id || 0)
    let cross = null
    if (instructorChanged) {
      cross = await crossDeptTarget(req.user.id, req.user.role, assigned_instructor_id)
      if (cross) {
        let credit = unitCredit(before.lec_hours, before.lab_hours)
        let subjId = before.subject_id
        if (subject_id) {
          const [[sub]] = await pool.query('SELECT lec_hours, lab_hours FROM prospectus_subjects WHERE id = ?', [subject_id])
          if (sub) { credit = unitCredit(sub.lec_hours, sub.lab_hours); subjId = subject_id }
        }
        const problem = await crossDeptProblem(cross, subjId, before.academic_year, before.semester, credit)
        if (problem) return res.status(400).json({ message: problem })
      }
    }
    // While a request is pending the entry itself stays unassigned.
    const finalAssigned = cross ? null : (assigned_instructor_id || null)
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
          subject.units, subject.lec_hours, subject.lab_hours, finalAssigned, room || null, subject_id, req.params.id])
    } else {
      await pool.query(`
        UPDATE faculty_load_entries SET
          program_yr_sec=?, year_level=?, assigned_instructor_id=?, room=?
        WHERE id=?
      `, [program_yr_sec, year_level || null, finalAssigned, room || null, req.params.id])
    }
    if (cross) {
      await createCrossDeptRequest(Number(req.params.id), cross.id, req.user.id, request_note)
    } else if (instructorChanged && assigned_instructor_id) {
      await cancelOpenCrossDeptRequests(req.params.id)   // now assigned directly — any open request is moot
    }
    const [[entry]] = await pool.query(
      'SELECT chair_id, academic_year, semester, assigned_instructor_id FROM faculty_load_entries WHERE id=?',
      [req.params.id]
    )
    if (entry) await syncConfirmation(entry.chair_id, entry.academic_year, entry.semester, entry.assigned_instructor_id)
    res.json(cross
      ? { message: 'Request sent.', pending_request: true, instructor_name: cross.name }
      : { message: 'Updated.' })
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
      SELECT u.id, u.name, u.department, u.programs,
        GROUP_CONCAT(CONCAT(isp.subject_id, ':', isp.priority)) AS specialty_ids
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

    // Build map: subject_id → { 1: [first-priority instructor ids], 2: [second-priority ids] }
    // Each instructor tags every specialty as 1st or 2nd priority (My Specialty page).
    const specialtyMap = {}
    for (const inst of instructors) {
      const picks = inst.specialty_ids ? inst.specialty_ids.split(',') : []
      for (const pick of picks) {
        const [sid, prio] = pick.split(':').map(Number)
        if (!specialtyMap[sid]) specialtyMap[sid] = { 1: [], 2: [] }
        specialtyMap[sid][prio === 2 ? 2 : 1].push(inst.id)
      }
    }
    // Partition the pool so GE subjects only draw from GE instructors,
    // PATHFIT subjects only draw from PATHFIT instructors, NSTP subjects
    // only draw from NSTP instructors, and major subjects only draw from
    // department instructors — never mixed.
    const geInstructorIds      = instructors.filter(i => i.department === 'General Education').map(i => i.id)
    const pathfitInstructorIds = instructors.filter(i => i.department === 'PATHFIT').map(i => i.id)
    const nstpInstructorIds    = instructors.filter(i => i.department === 'NSTP').map(i => i.id)
    // An instructor can be tagged with the programs they teach for (e.g. BSIT,
    // BSIS or both — set by the admin or on their My Specialty page). One who
    // is tagged is only eligible for a chair whose prospectus is one of those
    // programs; untagged instructors stay eligible for every program in the
    // department, as before.
    const teachesProgram = (i) => {
      const list = String(i.programs || '').split(',').map(p => p.trim().toUpperCase()).filter(Boolean)
      return !list.length || list.includes(String(program || '').trim().toUpperCase())
    }
    const majorInstructorIds   = instructors.filter(i =>
      i.department !== 'General Education' && i.department !== 'PATHFIT' && i.department !== 'NSTP' && teachesProgram(i)
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

    // ── Priority-ordered assignment ────────────────────────────────────────────
    // Every specialty is tagged 1st or 2nd priority by the instructor. Subjects
    // are handed out in passes so first choices always win before any second
    // choice is considered, and an instructor only picks up their second-priority
    // subjects once they still have room under the standard load:
    //   1. FIRST-priority specialists with room within TARGET_UNITS (21)
    //   2. SECOND-priority specialists with room within TARGET_UNITS
    //   3. Overflow: first- then second-priority specialists up to MAX_UNITS (27)
    //   4. Last resort: a specialist even past MAX_UNITS, rather than leaving a
    //      specialized subject unassigned — the chair sees the visible overload
    //      on their card and can rebalance before submitting.
    // A subject with no specialist at all is left unassigned for the chair to
    // assign manually. Within a subject, all its sections stick with the same
    // instructor (BSIT 2A, 2B, 2C of one course go to one person) for as long as
    // they have room, and only then spill to the next specialist. GE subjects
    // only draw from GE instructors, PATHFIT from PATHFIT, NSTP from NSTP, and
    // major subjects only from department instructors. NSTP never counts toward
    // the cap, so it never uses up an instructor's room.
    const byLoad = (ids) => [...new Set(ids)].sort((a, b) => (loadMap[a] || 0) - (loadMap[b] || 0))
    const stickyBySubject = new Map()   // subject id → instructor already teaching its earlier sections
    for (const e of existingMap.values()) {
      if (e.assigned_instructor_id && !stickyBySubject.has(e.subject_id)) stickyBySubject.set(e.subject_id, e.assigned_instructor_id)
    }

    const pending = []   // { idx, sub, credit, first[], second[] } for entries that still need an instructor
    expandedSubjects.forEach((sub, idx) => {
      const existing = existingMap.get(`${sub.id}|${sub.program_yr_sec}`)
      if (existing?.assigned_instructor_id) return
      const eligiblePool = isGeneralEd(sub.course_code) ? geInstructorIds
        : isPathfit(sub.course_code) ? pathfitInstructorIds
        : isNstp(sub.course_code) ? nstpInstructorIds
        : majorInstructorIds
      const tiers = specialtyMap[sub.id] || { 1: [], 2: [] }
      pending.push({
        idx, sub,
        credit: isNstp(sub.course_code) ? 0 : unitCredit(sub.lec_hours, sub.lab_hours),
        first:  tiers[1].filter(id => eligiblePool.includes(id)),
        second: tiers[2].filter(id => eligiblePool.includes(id)),
      })
    })

    const assignments = new Map()   // expandedSubjects index → instructor id
    const give = (p, id) => {
      assignments.set(p.idx, id)
      loadMap[id] = (loadMap[id] || 0) + p.credit
      stickyBySubject.set(p.sub.id, id)
    }
    // Try one tier: the subject's current instructor first (keeps sections together),
    // otherwise the least-loaded specialist who still fits under `limit`.
    const tryTier = (p, ids, limit) => {
      const sticky = stickyBySubject.get(p.sub.id)
      if (sticky && ids.includes(sticky) && (loadMap[sticky] || 0) + p.credit <= limit) { give(p, sticky); return true }
      const pick = byLoad(ids).find(id => (loadMap[id] || 0) + p.credit <= limit)
      if (pick == null) return false
      give(p, pick)
      return true
    }
    const runPass = (fn) => { for (const p of pending) if (!assignments.has(p.idx)) fn(p) }

    runPass(p => tryTier(p, p.first,  TARGET_UNITS))
    runPass(p => tryTier(p, p.second, TARGET_UNITS))
    runPass(p => tryTier(p, p.first,  MAX_UNITS) || tryTier(p, p.second, MAX_UNITS))
    runPass(p => {
      const last = byLoad(p.first)[0] ?? byLoad(p.second)[0]
      if (last != null) give(p, last)
    })

    const rows = []
    const toFill = []   // [assignedId, entryId] — existing unassigned entries now filled
    let alreadyAssignedCount = 0
    let stillUnassignedCount = 0
    expandedSubjects.forEach((sub, idx) => {
      const existing = existingMap.get(`${sub.id}|${sub.program_yr_sec}`)
      if (existing?.assigned_instructor_id) {
        alreadyAssignedCount++
        return
      }
      const assignedId = assignments.get(idx) ?? null

      if (existing) {
        if (assignedId) toFill.push([assignedId, existing.id])
        else stillUnassignedCount++
        return
      }

      rows.push([
        academic_year, semester,
        sub.course_code, sub.descriptive_title,
        sub.program_yr_sec,
        sub.year_level || null,
        sub.units, sub.lec_hours, sub.lab_hours,
        assignedId, null, sub.id, req.user.id
      ])
    })

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
