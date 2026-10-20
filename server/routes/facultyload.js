import { creditOf } from '../utils/unitCredit.js'
import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { generateFacultyLoadingDocx } from '../utils/facultyLoadingDocx.js'
import { programKey } from '../utils/detectProgram.js'
import { buildIflWorkbook } from '../utils/iflExcel.js'
import { rescheduleConflicts } from '../utils/rescheduleEntries.js'

const router = Router()

// While a submission is still at the instructor-confirmation stage, an
// instructor newly assigned (or reassigned) to a subject needs to be pulled
// into that same confirmation set — otherwise their load would be silently
// excluded from the whole approval chain until the submission either
// finishes or gets returned and resubmitted from scratch.
export async function syncConfirmation(chairId, academicYear, semester, instructorId) {
  if (!instructorId) return
  // A placeholder can't confirm anything (see submissions.js) — never queue one.
  const [[who]] = await pool.query('SELECT is_placeholder FROM users WHERE id = ?', [instructorId])
  if (who?.is_placeholder) return
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

// Four disjoint instructor pools: General Education ("GE" prefix), PATHFIT
// ("PATHFIT" prefix), NSTP ("NSTP" prefix — with or without a trailing
// number, since some prospectuses code it as bare "NSTP"), and major/
// department subjects, which may only go to instructors from the department
// that owns the prospectus. A subject in one pool may only be taught by an
// instructor from that same pool's department — never mixed.
export function isGeneralEd(courseCode) {
  return /^GE\b/i.test(String(courseCode || '').trim())
}
export function isPathfit(courseCode) {
  return /^PATHFIT\b/i.test(String(courseCode || '').trim())
}
function isNstp(courseCode) {
  return /^NSTP\b/i.test(String(courseCode || '').trim())
}
// GE and PATHFIT have no department of their own — their instructors teach
// every college's students — so both are assigned centrally by the GE
// Coordinator rather than picked directly by each chair. Returns the pool's
// department name ('General Education' / 'PATHFIT') or null for anything else.
export function coordinatorPool(courseCode) {
  if (isGeneralEd(courseCode)) return 'General Education'
  if (isPathfit(courseCode)) return 'PATHFIT'
  return null
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
    `SELECT assigned_instructor_id AS instructor_id, lec_hours, lab_hours, course_code, descriptive_title, units
     FROM faculty_load_entries
     WHERE academic_year=? AND semester=? AND assigned_instructor_id IS NOT NULL`,
    [academic_year, semester]
  )
  const map = {}
  for (const r of teachRows) {
    if (isNstp(r.course_code)) continue
    map[r.instructor_id] = (map[r.instructor_id] || 0) + creditOf(r)
  }
  const otherMap = await getOtherLoadMap(academic_year, semester)
  for (const [id, units] of Object.entries(otherMap)) {
    map[id] = (map[id] || 0) + units
  }
  return map
}

// ── Teaching for ANOTHER department ─────────────────────────────────────────
// A chair can't assign an instructor from a different department here at all
// — that's no longer a direct pick. Borrowing one goes through the full
// chain instead (Chair -> own Dean -> other Dean -> their Chair ->
// Instructor; see routes/crossDeptChain.js), so this just detects the
// attempt and points the chair there. The shared GE, PATHFIT and NSTP pools
// are exempt: every department draws on them by design.
const POOL_DEPARTMENTS = new Set(['General Education', 'PATHFIT', 'NSTP'])

// Returns the instructor (with id/name/department) if assigning them would
// cross departments for this chair, otherwise null.
async function otherDepartmentTarget(chairId, actorRole, instructorId) {
  if (!instructorId || actorRole !== 'chair') return null
  const [[chair]] = await pool.query('SELECT department FROM users WHERE id = ?', [chairId])
  const [[inst]] = await pool.query('SELECT id, name, department FROM users WHERE id = ?', [instructorId])
  if (!chair || !inst || !inst.department) return null
  if (inst.department === chair.department || POOL_DEPARTMENTS.has(inst.department)) return null
  return inst
}

// A same-department instructor who has tagged specific programs (users.programs,
// e.g. BSIT-only in a CCIS that also runs BSIS) can't hold a subject from a
// program they didn't pick — this is the "wrong subject" bug: a BSIS-only
// instructor ending up on a BSIT chair's load just because they share CCIS.
// An untagged instructor (programs empty) is open to every program in their
// department, so nothing is checked for them.
async function programMismatchProblem(instructorId, subjectId) {
  if (!instructorId || !subjectId) return null
  const [[inst]] = await pool.query('SELECT name, department, programs FROM users WHERE id = ?', [instructorId])
  const [[subj]] = await pool.query(
    `SELECT p.program FROM prospectus_subjects ps LEFT JOIN prospectus p ON p.id = ps.prospectus_id WHERE ps.id = ?`, [subjectId]
  )
  if (!inst || !subj?.program || !inst.programs) return null
  const allowed = inst.programs.split(',').map(programKey)
  if (allowed.includes(programKey(subj.program))) return null
  return `${inst.name} teaches for ${inst.programs} — this subject belongs to the ${subj.program} prospectus. Pick an instructor tagged for ${subj.program}, or fix their programs under Manage Users if that's wrong.`
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
        u.is_placeholder AS instructor_is_placeholder,
        ps.prerequisite,
        p.program AS subject_program,
        (fle.assigned_instructor_id IS NOT NULL AND u.department = c.department
          AND u.programs IS NOT NULL AND u.programs <> ''
          AND p.program IS NOT NULL AND NOT FIND_IN_SET(p.program, u.programs)) AS program_mismatch,
        (SELECT c.stage FROM cross_dept_chain c WHERE c.entry_id = fle.id AND c.stage NOT IN ('finalized','cancelled') ORDER BY c.id DESC LIMIT 1) AS request_status,
        (SELECT COALESCE(ci.name, c.target_department) FROM cross_dept_chain c LEFT JOIN users ci ON ci.id = c.instructor_id WHERE c.entry_id = fle.id AND c.stage NOT IN ('finalized','cancelled') ORDER BY c.id DESC LIMIT 1) AS request_instructor,
        (SELECT c.decline_stage FROM cross_dept_chain c WHERE c.entry_id = fle.id AND c.stage = 'declined' ORDER BY c.id DESC LIMIT 1) AS request_declined_stage,
        (SELECT c.decline_reason FROM cross_dept_chain c WHERE c.entry_id = fle.id AND c.stage = 'declined' ORDER BY c.id DESC LIMIT 1) AS request_decline_reason
      FROM faculty_load_entries fle
      LEFT JOIN users u ON fle.assigned_instructor_id = u.id
      LEFT JOIN users c ON fle.chair_id = c.id
      LEFT JOIN prospectus_subjects ps ON fle.subject_id = ps.id
      LEFT JOIN prospectus p ON ps.prospectus_id = p.id
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

    const [[subject]] = await pool.query(
      `SELECT ps.course_code, p.program FROM prospectus_subjects ps
       LEFT JOIN prospectus p ON p.id = ps.prospectus_id WHERE ps.id = ?`, [req.params.subjectId]
    )
    const requiredDept = isGeneralEd(subject?.course_code) ? 'General Education'
      : isPathfit(subject?.course_code) ? 'PATHFIT'
      : isNstp(subject?.course_code) ? 'NSTP'
      : null

    // GE subjects only show GE instructors, PATHFIT subjects only show PATHFIT
    // instructors, NSTP subjects only show NSTP instructors, and major
    // subjects only show instructors from the chair's own department — this
    // picker never reaches into another department at all; borrowing an
    // instructor from elsewhere goes through Teaching Requests -> Request an
    // Instructor (the Dean-to-Dean chain in routes/crossDeptChain.js) instead.
    // A department that runs more than one program (e.g. CCIS has BSIT and
    // BSIS) can have instructors who only teach for one of them (users.programs).
    // An untagged instructor (programs empty) is open to every program in the
    // department, as documented on the column.
    const [[me]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    const deptCondition = requiredDept
      ? 'u.department = ?'
      : `(u.department = ? AND (u.programs IS NULL OR u.programs = '' OR ? IS NULL OR FIND_IN_SET(?, u.programs)))`
    const deptParams = requiredDept
      ? [requiredDept]
      : [me?.department, subject?.program || null, subject?.program || null]

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
      WHERE u.role IN ('instructor', 'chair', 'dean') AND u.is_placeholder = 0 AND ${deptCondition}
      ORDER BY has_specialty DESC, specialty_priority ASC, u.name ASC
    `, [req.params.subjectId, req.params.subjectId, ...deptParams])

    const result = instructors.map(i => ({ ...i, current_units: loadMap[i.id] || 0, has_specialty: i.has_specialty > 0 }))

    res.json(result)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/faculty-load/instructors-all — all instructors with current load.
// Also used by the GE Coordinator dashboard to show GE/PATHFIT instructors'
// current loads when picking who to assign.
router.get('/instructors-all', authenticate, authorize('chair', 'admin', 'ge_coordinator'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const loadMap = await getCombinedLoadMap(year, semester)

    const [instructors] = await pool.query(
      "SELECT id, name, department, role, (department = 'General Education') AS is_ge, (department = 'PATHFIT') AS is_pathfit, (department = 'NSTP') AS is_nstp FROM users WHERE role IN ('instructor', 'chair', 'dean') AND is_placeholder = 0 ORDER BY department, name"
    )
    res.json(instructors.map(i => ({ ...i, current_units: loadMap[i.id] || 0 })))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// The same subject landing twice on one section's load sheet (a double
// submit, or re-adding after a page glitch) double-books whichever
// instructor it's assigned to once the schedule is generated — the engine
// then reports a real "assigned to the same course twice" conflict, which
// looks like a scheduling bug but is actually duplicate source data.
// excludeId lets PUT check "does this change collide with some OTHER row"
// without the row being edited flagging itself as its own duplicate.
async function duplicateEntryExists(chairId, academicYear, semester, subjectId, programYrSec, excludeId = null) {
  const section = (programYrSec || '').trim()
  if (!section) return false
  const params = [chairId, academicYear, semester, subjectId, section]
  let sql = `SELECT id FROM faculty_load_entries
    WHERE chair_id = ? AND academic_year = ? AND semester = ? AND subject_id = ? AND TRIM(program_yr_sec) = ?`
  if (excludeId) { sql += ' AND id != ?'; params.push(excludeId) }
  const [[dup]] = await pool.query(sql, params)
  return !!dup
}

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
    if (await duplicateEntryExists(req.user.id, academic_year, semester, subject_id, program_yr_sec)) {
      return res.status(409).json({ message: `${subject.course_code} is already on the load sheet for ${program_yr_sec} this term — edit that entry instead of adding it again.` })
    }
    // Another department's instructor → that's not a direct pick here at all.
    const cross = await otherDepartmentTarget(req.user.id, req.user.role, assigned_instructor_id)
    if (cross) {
      return res.status(400).json({ message: `${cross.name} is from ${cross.department} — to borrow them, ask your Dean under Teaching Requests → Request an Instructor. Leave this subject unassigned for now.` })
    }
    if (assigned_instructor_id && req.user.role === 'chair' && coordinatorPool(subject.course_code)) {
      return res.status(400).json({ message: `${coordinatorPool(subject.course_code)} subjects are assigned by the GE Coordinator, not picked here. Save this unassigned, then request an instructor for it under Teaching Requests.` })
    }
    if (assigned_instructor_id) {
      const problem = await programMismatchProblem(assigned_instructor_id, subject_id)
      if (problem) return res.status(400).json({ message: problem })
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
    // Only when the instructor is actually being CHANGED: an inline edit of
    // Section/Room re-sends the current (or still-unassigned) value untouched.
    const [[before]] = await pool.query(
      'SELECT chair_id, assigned_instructor_id, subject_id, course_code, lec_hours, lab_hours, descriptive_title, units, academic_year, semester FROM faculty_load_entries WHERE id = ?',
      [req.params.id]
    )
    if (!before) return res.status(404).json({ message: 'Entry not found.' })

    let subject = null
    if (subject_id) {
      const [[found]] = await pool.query('SELECT * FROM prospectus_subjects WHERE id = ?', [subject_id])
      if (!found) {
        return res.status(400).json({ message: 'That subject was not found in the uploaded prospectus.' })
      }
      subject = found
    }
    const effectiveCourseCode = subject ? subject.course_code : before.course_code
    const effectiveSubjectId = subject_id || before.subject_id
    if (effectiveSubjectId && await duplicateEntryExists(before.chair_id, before.academic_year, before.semester, effectiveSubjectId, program_yr_sec, req.params.id)) {
      return res.status(409).json({ message: `${effectiveCourseCode} is already on the load sheet for ${program_yr_sec} this term — that's a different entry.` })
    }

    const instructorChanged = Number(assigned_instructor_id || 0) !== Number(before.assigned_instructor_id || 0)
    if (instructorChanged) {
      const cross = await otherDepartmentTarget(req.user.id, req.user.role, assigned_instructor_id)
      if (cross) {
        return res.status(400).json({ message: `${cross.name} is from ${cross.department} — to borrow them, ask your Dean under Teaching Requests → Request an Instructor. Leave this subject unassigned for now.` })
      }
      if (assigned_instructor_id && req.user.role === 'chair' && coordinatorPool(effectiveCourseCode)) {
        return res.status(400).json({ message: `${coordinatorPool(effectiveCourseCode)} subjects are assigned by the GE Coordinator, not picked here. Leave this unassigned, then request an instructor for it under Teaching Requests.` })
      }
      if (assigned_instructor_id) {
        const problem = await programMismatchProblem(assigned_instructor_id, subject_id || before.subject_id)
        if (problem) return res.status(400).json({ message: problem })
      }
    }
    const finalAssigned = assigned_instructor_id || null
    // A real instructor landing here resolves whatever the "needs another
    // department" flag was about — clear it. Still unassigned leaves it as is.
    const clearFlagSql = finalAssigned ? ', needs_instructor_reason = NULL' : ''
    if (subject) {
      await pool.query(`
        UPDATE faculty_load_entries SET
          course_code=?, descriptive_title=?, program_yr_sec=?, year_level=?, units=?, lec_hours=?, lab_hours=?,
          assigned_instructor_id=?, room=?, subject_id=?${clearFlagSql}
        WHERE id=?
      `, [subject.course_code, subject.descriptive_title, program_yr_sec, year_level || null,
          subject.units, subject.lec_hours, subject.lab_hours, finalAssigned, room || null, subject_id, req.params.id])
    } else {
      await pool.query(`
        UPDATE faculty_load_entries SET
          program_yr_sec=?, year_level=?, assigned_instructor_id=?, room=?${clearFlagSql}
        WHERE id=?
      `, [program_yr_sec, year_level || null, finalAssigned, room || null, req.params.id])
    }
    const [[entry]] = await pool.query(
      'SELECT chair_id, academic_year, semester, assigned_instructor_id FROM faculty_load_entries WHERE id=?',
      [req.params.id]
    )
    if (entry) await syncConfirmation(entry.chair_id, entry.academic_year, entry.semester, entry.assigned_instructor_id)

    // A subject already generated/published that gets handed to a different
    // real instructor here was never checked against what that instructor
    // already teaches elsewhere — this is the one place that was missing the
    // same check placeholder-replace already does, which let one real
    // instructor end up double-booked across two different subjects with
    // nothing catching it until someone opened the conflict panel.
    let scheduleNote = ''
    if (instructorChanged && finalAssigned && entry) {
      const [[newInst]] = await pool.query('SELECT name, is_placeholder FROM users WHERE id = ?', [finalAssigned])
      if (newInst && !newInst.is_placeholder) {
        try {
          const resched = await rescheduleConflicts({
            academicYear: entry.academic_year, semester: entry.semester,
            movedEntryIds: [Number(req.params.id)], instructorId: finalAssigned,
          })
          if (resched.rescheduled.length) {
            scheduleNote = ` ${resched.rescheduled[0].courseCode} was moved to ${resched.rescheduled[0].after.join(', ') || 'a different time/room'} to avoid clashing with ${newInst.name || 'their'} existing classes.`
          } else if (resched.unresolved.length) {
            scheduleNote = ` Warning: ${resched.unresolved[0].courseCode} now clashes with an existing class and no open slot was found — ${resched.unresolved[0].reason}`
          }
        } catch (err) {
          console.error('[faculty-load] reschedule failed:', err.message)
        }
      }
    }
    res.json({ message: `Updated.${scheduleNote}` })
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

const VALID_LOAD_TYPES = new Set(['administrative', 'research', 'extension', 'project', 'consultation', 'lesson_prep'])
const HOURS_ONLY_TYPES = new Set(['consultation', 'lesson_prep'])
const HOURS_ONLY_LABEL = { consultation: 'Consultation', lesson_prep: 'Lesson Preparation' }
// Same 40-hour weekly cap used when a chair approves an instructor's own
// load request (routes/loadRequests.js) — a chair adding load directly,
// including for themselves, must clear the same bar.
const CONTACT_HRS_MAX = 40

// POST /api/faculty-load/admin-load — administrative/research/extension/
// project (unit credit) or consultation/lesson prep (hours only, no unit
// credit). A chair adds this directly — for themselves or for an instructor
// in their department — with no separate approval step, since the chair IS
// the approver on the instructor-request version of this same thing
// (routes/loadRequests.js); both paths write to the same faculty_admin_loads
// table and count the same way everywhere else in the system.
router.post('/admin-load', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { instructor_id, academic_year, semester, description, units, hours, load_type } = req.body
  if (!instructor_id || !academic_year || !semester) {
    return res.status(400).json({ message: 'instructor_id, academic_year and semester are required.' })
  }
  if (!VALID_LOAD_TYPES.has(load_type)) {
    return res.status(400).json({ message: 'Invalid load type.' })
  }
  const isHoursOnly = HOURS_ONLY_TYPES.has(load_type)
  if (isHoursOnly) {
    if (!hours || Number(hours) <= 0) return res.status(400).json({ message: 'Hours is required.' })
  } else {
    if (!description || !String(description).trim()) return res.status(400).json({ message: 'Title is required.' })
    if (!units || Number(units) <= 0) return res.status(400).json({ message: 'Unit credit is required.' })
  }
  const finalDescription = isHoursOnly ? HOURS_ONLY_LABEL[load_type] : description.trim()
  const finalUnits = isHoursOnly ? 0 : Number(units)
  const finalHours = isHoursOnly ? Number(hours) : null

  try {
    if (isHoursOnly) {
      // Total weekly Contact Hours (teaching + existing hours-only load + this
      // one) may never exceed the cap — same check as approving a request.
      const [[teach]] = await pool.query(
        `SELECT COALESCE(SUM(lec_hours + lab_hours), 0) AS total FROM faculty_load_entries
         WHERE assigned_instructor_id = ? AND academic_year = ? AND semester = ?`,
        [instructor_id, academic_year, semester]
      )
      const [[existing]] = await pool.query(
        `SELECT COALESCE(SUM(hours), 0) AS total FROM faculty_admin_loads
         WHERE instructor_id = ? AND academic_year = ? AND semester = ? AND load_type IN ('consultation', 'lesson_prep')`,
        [instructor_id, academic_year, semester]
      )
      const projected = Number(teach.total) + Number(existing.total) + finalHours
      if (projected > CONTACT_HRS_MAX) {
        return res.status(409).json({ message: `This would bring total Contact Hours to ${projected}, over the ${CONTACT_HRS_MAX}-hour maximum.` })
      }
    } else {
      const load = (await getCombinedLoadMap(academic_year, semester))[instructor_id] || 0
      const projected = load + finalUnits
      if (projected > MAX_UNITS) {
        return res.status(409).json({ message: `This would bring total unit credit to ${projected.toFixed(2)}, over the ${MAX_UNITS}-unit cap.` })
      }
    }

    const [r] = await pool.query(`
      INSERT INTO faculty_admin_loads (instructor_id, academic_year, semester, description, units, hours, lec_hours, lab_hours, load_type, chair_id)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `, [instructor_id, academic_year, semester, finalDescription, finalUnits, finalHours, load_type, req.user.id])
    res.status(201).json({ id: r.insertId, message: 'Added.' })
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

// POST /api/faculty-load/auto-generate — builds the term's subject/section
// roster from a prospectus. It never picks an instructor for anything: every
// row comes out unassigned, whether it's a major subject (the chair fills it
// via Placeholders → swap in a real instructor) or a GE/PATHFIT subject (the
// GE Coordinator fills it centrally). Specialty-based auto-matching was
// removed — two chairs running this independently could no longer silently
// overload the same shared-pool instructor, and a placeholder standing in for
// "nobody yet" is a clearer state than a guessed specialist.
router.post('/auto-generate', authenticate, authorize('chair', 'admin'), async (req, res) => {
  const { academic_year, semester, prospectus_id, clear_existing } = req.body
  try {
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

    // Only generate entries for the selected term's semester. NSTP is never
    // part of this system's load or schedule (it's dropped on prospectus
    // import now, but a prospectus uploaded before that fix shipped can
    // still have legacy NSTP rows sitting in prospectus_subjects — filtered
    // out here too so it can never resurface through Auto-Generate).
    subjects = subjects.filter(s => Number(s.semester) === Number(semester) && !isNstp(s.course_code))

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

    // Safe to re-run: match against what's already there (by subject +
    // section) instead of blindly inserting a duplicate batch. Anything
    // already on the sheet — assigned or still on a placeholder — is left
    // completely untouched; only a genuinely new subject/section is inserted.
    let existingKeys = new Set()
    if (clear_existing) {
      await pool.query(
        'DELETE FROM faculty_load_entries WHERE academic_year=? AND semester=? AND chair_id=?',
        [academic_year, semester, req.user.id]
      )
    } else {
      const [existingRows] = await pool.query(
        'SELECT subject_id, program_yr_sec FROM faculty_load_entries WHERE academic_year=? AND semester=? AND chair_id=?',
        [academic_year, semester, req.user.id]
      )
      existingKeys = new Set(existingRows.map(e => `${e.subject_id}|${e.program_yr_sec}`))
    }

    const rows = []
    let alreadyPresentCount = 0
    expandedSubjects.forEach(sub => {
      if (existingKeys.has(`${sub.id}|${sub.program_yr_sec}`)) { alreadyPresentCount++; return }
      rows.push([
        academic_year, semester,
        sub.course_code, sub.descriptive_title,
        sub.program_yr_sec,
        sub.year_level || null,
        sub.units, sub.lec_hours, sub.lab_hours,
        null, null, sub.id, req.user.id
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

    res.json({
      count: rows.length + alreadyPresentCount,
      assigned: alreadyPresentCount, unassigned: rows.length,
      message: `${rows.length} subject${rows.length === 1 ? '' : 's'} added, all unassigned. Major subjects: use Placeholders to park them on a mock instructor, then swap in a real one. GE/PATHFIT: request an instructor for them under Teaching Requests.`,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/faculty-load/confirmations?year=&semester=  — the chair's view of
// who has confirmed their load for the term, who is still waiting, and who
// hasn't been asked yet (not on a submission). Placeholders aren't people,
// so they're left out.
router.get('/confirmations', authenticate, authorize('chair'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [[sub]] = await pool.query(
      'SELECT id FROM submissions WHERE chair_id = ? AND academic_year = ? AND semester = ? ORDER BY id DESC LIMIT 1',
      [req.user.id, year, semester]
    )
    const [instructors] = await pool.query(`
      SELECT DISTINCT u.id, u.name, u.department
      FROM faculty_load_entries fle
      JOIN users u ON u.id = fle.assigned_instructor_id
      WHERE fle.chair_id = ? AND fle.academic_year = ? AND fle.semester = ? AND u.is_placeholder = 0
      ORDER BY u.name`, [req.user.id, year, semester])
    const confirmations = new Map()
    if (sub) {
      const [rows] = await pool.query(
        'SELECT instructor_id, confirmed_at FROM submission_confirmations WHERE submission_id = ?', [sub.id])
      for (const r of rows) confirmations.set(r.instructor_id, r)
    }
    const out = { confirmed: [], pending: [], not_asked: [] }
    for (const i of instructors) {
      const c = confirmations.get(i.id)
      if (c && c.confirmed_at) out.confirmed.push({ ...i, confirmed_at: c.confirmed_at })
      else if (c) out.pending.push(i)
      else out.not_asked.push(i)
    }
    res.json(out)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/faculty-load/my-load.xlsx?year=&semester=  — the calling person's
// Individual Faculty Load as an Excel sheet, in the institution's own layout
// (timetable on the left, summary of load on the right, sign-off below).
router.get('/my-load.xlsx', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [[me]] = await pool.query('SELECT name, department, role FROM users WHERE id = ?', [req.user.id])
    const [entries] = await pool.query(`
      SELECT fle.* FROM faculty_load_entries fle
      WHERE fle.academic_year = ? AND fle.semester = ? AND fle.assigned_instructor_id = ?
      ORDER BY fle.sort_order, fle.id`, [year, semester, req.user.id])
    const [sessions] = await pool.query(`
      SELECT gs.days, gs.start_time, gs.end_time, gs.session_type,
             fle.course_code, fle.program_yr_sec,
             CASE WHEN r.id IS NULL THEN NULL ELSE CONCAT(r.building, ' ', r.room_number) END AS room
      FROM generated_schedules gs
      JOIN faculty_load_entries fle ON fle.id = gs.faculty_entry_id
      LEFT JOIN rooms r ON r.id = gs.room_id
      WHERE fle.assigned_instructor_id = ? AND fle.academic_year = ? AND fle.semester = ?`,
      [req.user.id, year, semester])
    const [adminLoads] = await pool.query(`
      SELECT load_type, description, units, hours FROM faculty_admin_loads
      WHERE academic_year = ? AND semester = ? AND instructor_id = ?`, [year, semester, req.user.id])

    // Signatories come from the accounts already in the system, not typed in.
    const [[dean]] = await pool.query("SELECT name FROM users WHERE role = 'dean' AND department = ? AND is_placeholder = 0 LIMIT 1", [me.department || ''])
    const [[registrar]] = await pool.query("SELECT name FROM users WHERE role = 'admin' AND is_placeholder = 0 ORDER BY id LIMIT 1")
    const [[vpaa]] = await pool.query("SELECT name FROM users WHERE role = 'vpaa' AND is_placeholder = 0 ORDER BY id LIMIT 1")

    const wb = await buildIflWorkbook({
      instructor: { name: me.name, department: me.department },
      semester: Number(semester), year,
      sessions, entries, adminLoads,
      signatories: { dean: dean?.name || '', registrar: registrar?.name || '', vpaa: vpaa?.name || '' },
    })
    const buf = await wb.xlsx.writeBuffer()
    const safe = String(me.name || 'IFL').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="IFL_${safe}_${year}_Sem${semester}.xlsx"`)
    res.send(Buffer.from(buf))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
