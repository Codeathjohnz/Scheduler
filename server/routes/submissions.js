import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { getCombinedLoadMap, MAX_UNITS } from './facultyload.js'

const router = Router()

// Chair: create manual submission
router.post('/', authenticate, authorize('chair'), async (req, res) => {
  const { entries } = req.body
  try {
    const [result] = await pool.query(
      'INSERT INTO submissions (chair_id, status, submission_type, created_at) VALUES (?, "pending_vpaa", "manual", NOW())',
      [req.user.id]
    )
    const submissionId = result.insertId
    for (const e of entries) {
      await pool.query(
        'INSERT INTO submission_entries (submission_id, instructor_id, subject_code, section, program, year_level) VALUES (?,?,?,?,?,?)',
        [submissionId, e.instructor_id, e.subject_code, e.section, e.program, e.year_level]
      )
    }
    res.status(201).json({ message: 'Submission created.', id: submissionId })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Chair: submit faculty load — starts the approval chain at Instructor
// confirmation (every assigned instructor must confirm their own load before
// it moves to Dean -> Chief Curriculum Planning and Development -> Quality
// Assurance -> VPAA -> Admin).
router.post('/from-faculty-load', authenticate, authorize('chair'), async (req, res) => {
  const { academic_year, semester } = req.body
  if (!academic_year || !semester) {
    return res.status(400).json({ message: 'academic_year and semester are required.' })
  }
  const conn = await pool.getConnection()
  try {
    // Block if a non-returned submission already exists for this term
    const [existing] = await conn.query(
      `SELECT id, status FROM submissions
       WHERE chair_id = ? AND academic_year = ? AND semester = ? AND status != 'returned'`,
      [req.user.id, academic_year, semester]
    )
    if (existing.length > 0) {
      conn.release()
      return res.status(409).json({
        message: `A submission for this term is already ${existing[0].status.replace(/_/g, ' ')}.`,
        status: existing[0].status,
      })
    }

    // Require at least one faculty load entry with an instructor assigned.
    // A subject can still be unassigned at submit time (e.g. short-staffed
    // departments genuinely have nobody to assign yet) — it just sits out of
    // the confirmation chain until the chair assigns someone and it's picked
    // up in a later submission; only entries with a real instructor generate
    // a confirmation row.
    const [entries] = await conn.query(
      'SELECT assigned_instructor_id FROM faculty_load_entries WHERE chair_id = ? AND academic_year = ? AND semester = ?',
      [req.user.id, academic_year, semester]
    )
    if (entries.length === 0) {
      conn.release()
      return res.status(400).json({ message: 'No faculty load entries found. Add entries in the Faculty Loading Sheet first.' })
    }
    // Requests to instructors from other departments must be settled first:
    // an answer arriving after submission wouldn't go through the confirmation
    // chain the rest of the load is going through.
    const [[open]] = await conn.query(
      `SELECT COUNT(*) AS n FROM cross_dept_requests r
       JOIN faculty_load_entries e ON e.id = r.entry_id
       WHERE e.chair_id = ? AND e.academic_year = ? AND e.semester = ? AND r.status IN ('pending_instructor', 'pending_home')`,
      [req.user.id, academic_year, semester]
    )
    if (open.n > 0) {
      conn.release()
      return res.status(400).json({
        message: `You still have ${open.n} teaching request${open.n > 1 ? 's' : ''} waiting on other departments. Wait for the answer (or withdraw it under Teaching Requests) before submitting.`,
      })
    }

    const instructorIds = [...new Set(entries.map(e => e.assigned_instructor_id).filter(Boolean))]
    if (instructorIds.length === 0) {
      conn.release()
      return res.status(400).json({ message: 'No instructors are assigned yet. Assign at least one instructor before submitting.' })
    }

    // Block if any assigned instructor is over the hard unit-credit cap —
    // Auto-Generate will assign a specialist even past the cap rather than
    // leave a specialized subject unassigned, so this is the backstop that
    // forces the chair to actually rebalance before it reaches instructors.
    const loadMap = await getCombinedLoadMap(academic_year, semester)
    const [instructorNames] = await conn.query(
      `SELECT id, name FROM users WHERE id IN (${instructorIds.map(() => '?').join(',')})`,
      instructorIds
    )
    const nameById = Object.fromEntries(instructorNames.map(u => [u.id, u.name]))
    const overloaded = instructorIds
      .filter(id => (loadMap[id] || 0) > MAX_UNITS)
      .map(id => `${nameById[id] || `#${id}`} (${(loadMap[id] || 0).toFixed(2)} units)`)
    if (overloaded.length > 0) {
      conn.release()
      return res.status(400).json({
        message: `${overloaded.length} instructor${overloaded.length > 1 ? 's are' : ' is'} over the ${MAX_UNITS}-unit cap: ${overloaded.join(', ')}. Unassign a subject or reduce their other load before submitting.`,
      })
    }

    await conn.beginTransaction()

    const [result] = await conn.query(
      `INSERT INTO submissions (chair_id, status, academic_year, semester, submission_type, created_at)
       VALUES (?, 'pending_instructor', ?, ?, 'faculty_load', NOW())`,
      [req.user.id, academic_year, semester]
    )
    const submissionId = result.insertId

    const confirmRows = instructorIds.map(id => [submissionId, id])
    await conn.query(
      'INSERT INTO submission_confirmations (submission_id, instructor_id) VALUES ?',
      [confirmRows]
    )

    await conn.commit()
    res.status(201).json({
      message: `Faculty load submitted. Waiting on ${instructorIds.length} instructor${instructorIds.length > 1 ? 's' : ''} to confirm.`,
      id: submissionId,
    })
  } catch (err) {
    await conn.rollback()
    res.status(500).json({ message: 'Server error.', error: err.message })
  } finally {
    conn.release()
  }
})

// Instructor (or a Chair/Dean assigned as a teaching instructor): submissions
// awaiting this person's confirmation
router.get('/my-confirmations', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT sc.id AS confirmation_id, sc.confirmed_at, s.id AS submission_id,
        s.academic_year, s.semester, s.status,
        u.name AS chair_name, u.department AS chair_dept
      FROM submission_confirmations sc
      JOIN submissions s ON sc.submission_id = s.id
      JOIN users u ON s.chair_id = u.id
      WHERE sc.instructor_id = ?
      ORDER BY sc.confirmed_at IS NOT NULL, s.created_at DESC
    `, [req.user.id])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Instructor (or a Chair/Dean assigned as a teaching instructor): view only
// their own entries within a submission, to review before confirming
router.get('/:id/my-entries', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  try {
    const [[sub]] = await pool.query('SELECT * FROM submissions WHERE id = ?', [req.params.id])
    if (!sub) return res.status(404).json({ message: 'Submission not found.' })

    const [entries] = await pool.query(`
      SELECT fle.* FROM faculty_load_entries fle
      WHERE fle.chair_id = ? AND fle.academic_year = ? AND fle.semester = ? AND fle.assigned_instructor_id = ?
      ORDER BY fle.sort_order, fle.id
    `, [sub.chair_id, sub.academic_year, sub.semester, req.user.id])
    res.json(entries)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Instructor (or a Chair/Dean assigned as a teaching instructor): confirm
// their share of the load — once every instructor on the submission has
// confirmed, it automatically advances to the Dean.
router.patch('/:id/confirm', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  const conn = await pool.getConnection()
  try {
    const [[confirmation]] = await conn.query(
      'SELECT * FROM submission_confirmations WHERE submission_id = ? AND instructor_id = ?',
      [req.params.id, req.user.id]
    )
    if (!confirmation) {
      conn.release()
      return res.status(404).json({ message: 'You have no load to confirm on this submission.' })
    }

    await conn.beginTransaction()
    await conn.query(
      'UPDATE submission_confirmations SET confirmed_at = NOW() WHERE id = ?',
      [confirmation.id]
    )

    const [[{ remaining }]] = await conn.query(
      'SELECT COUNT(*) AS remaining FROM submission_confirmations WHERE submission_id = ? AND confirmed_at IS NULL',
      [req.params.id]
    )
    let advanced = false
    if (remaining === 0) {
      await conn.query(
        `UPDATE submissions SET status = 'pending_dean' WHERE id = ? AND status = 'pending_instructor'`,
        [req.params.id]
      )
      advanced = true
    }

    await conn.commit()
    res.json({ message: advanced ? 'Confirmed — all instructors have now confirmed, sent to the Dean.' : 'Confirmed.', advanced })
  } catch (err) {
    await conn.rollback()
    res.status(500).json({ message: 'Server error.', error: err.message })
  } finally {
    conn.release()
  }
})

// Dean: submissions from chairs in the Dean's own college/department
router.get('/dean', authenticate, authorize('dean'), async (req, res) => {
  try {
    const [[dean]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    const dept = dean?.department
    const deptFilter = dept ? 'AND u.department = ?' : ''
    const params = dept ? [dept] : []
    const [rows] = await pool.query(`
      SELECT s.*,
        u.name       AS chair_name,
        u.department AS chair_dept,
        (SELECT COUNT(*) FROM submission_entries se WHERE se.submission_id = s.id) AS manual_entry_count,
        (SELECT COUNT(*) FROM faculty_load_entries fle
          WHERE fle.chair_id = s.chair_id
            AND fle.academic_year = s.academic_year
            AND fle.semester = s.semester) AS faculty_entry_count
      FROM submissions s
      JOIN users u ON s.chair_id = u.id
      WHERE s.status IN ('pending_dean', 'pending_chief_cpd', 'pending_qa', 'pending_vpaa', 'pending_admin', 'validated', 'scheduled', 'returned') ${deptFilter}
      ORDER BY
        FIELD(s.status, 'pending_dean', 'returned', 'pending_chief_cpd', 'pending_qa', 'pending_vpaa', 'pending_admin', 'validated', 'scheduled'),
        s.created_at DESC
    `, params)
    const mapped = rows.map(r => ({
      ...r,
      entry_count: r.submission_type === 'faculty_load' ? r.faculty_entry_count : r.manual_entry_count,
    }))
    res.json(mapped)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Dean: confirm or return
router.patch('/:id/dean', authenticate, authorize('dean'), async (req, res) => {
  const { action } = req.body
  const status = action === 'confirm' ? 'pending_chief_cpd' : 'returned'
  try {
    await pool.query('UPDATE submissions SET status = ?, dean_action_at = NOW() WHERE id = ?', [status, req.params.id])
    res.json({ message: `Submission ${status}.` })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Dean: revert a previous confirm — sends the whole chain back to
// pending_dean, undoing Chief CPD/QA/VPAA/Admin's downstream actions too
// (their old action timestamps are cleared so they see a clean slate once
// the Dean re-confirms). Blocked once a schedule has actually been
// generated from this data ('scheduled') — an admin would need to clear
// that schedule first, since real room/time assignments would otherwise be
// left pointing at data that's no longer dean-approved.
router.patch('/:id/dean-revert', authenticate, authorize('dean'), async (req, res) => {
  try {
    const [[dean]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    const [[sub]] = await pool.query(
      `SELECT s.status, u.department AS chair_dept FROM submissions s
       JOIN users u ON s.chair_id = u.id WHERE s.id = ?`,
      [req.params.id]
    )
    if (!sub) return res.status(404).json({ message: 'Submission not found.' })
    if (dean?.department && sub.chair_dept !== dean.department) {
      return res.status(403).json({ message: 'Access denied.' })
    }
    if (sub.status === 'scheduled') {
      return res.status(409).json({ message: 'A schedule has already been generated from this submission — an admin must clear it before you can revert.' })
    }
    const REVERTIBLE = new Set(['pending_chief_cpd', 'pending_qa', 'pending_vpaa', 'pending_admin', 'validated'])
    if (!REVERTIBLE.has(sub.status)) {
      return res.status(409).json({ message: `Cannot revert a submission that is currently ${sub.status.replace(/_/g, ' ')}.` })
    }
    await pool.query(
      `UPDATE submissions SET status = 'pending_dean',
         dean_action_at = NULL, chief_cpd_action_at = NULL, qa_action_at = NULL, vpaa_action_at = NULL, admin_action_at = NULL
       WHERE id = ?`,
      [req.params.id]
    )
    res.json({ message: 'Submission reverted to Pending Dean Review. Chief CPD, QA, VPAA, and Admin will need to review it again.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Chief Curriculum Planning and Development: all submissions at or past
// their stage (unscoped — one person handles all colleges, like VPAA/QA)
router.get('/chief-cpd', authenticate, authorize('chief_cpd'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*,
        u.name       AS chair_name,
        u.department AS chair_dept,
        (SELECT COUNT(*) FROM submission_entries se WHERE se.submission_id = s.id) AS manual_entry_count,
        (SELECT COUNT(*) FROM faculty_load_entries fle
          WHERE fle.chair_id = s.chair_id
            AND fle.academic_year = s.academic_year
            AND fle.semester = s.semester) AS faculty_entry_count
      FROM submissions s
      JOIN users u ON s.chair_id = u.id
      WHERE s.status IN ('pending_chief_cpd', 'pending_qa', 'pending_vpaa', 'pending_admin', 'validated', 'scheduled', 'returned')
      ORDER BY
        FIELD(s.status, 'pending_chief_cpd', 'returned', 'pending_qa', 'pending_vpaa', 'pending_admin', 'validated', 'scheduled'),
        s.created_at DESC
    `)
    const mapped = rows.map(r => ({
      ...r,
      entry_count: r.submission_type === 'faculty_load' ? r.faculty_entry_count : r.manual_entry_count,
    }))
    res.json(mapped)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Chief CPD: confirm or return
router.patch('/:id/chief-cpd', authenticate, authorize('chief_cpd'), async (req, res) => {
  const { action } = req.body
  const status = action === 'confirm' ? 'pending_qa' : 'returned'
  try {
    await pool.query('UPDATE submissions SET status = ?, chief_cpd_action_at = NOW() WHERE id = ?', [status, req.params.id])
    res.json({ message: `Submission ${status}.` })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Chief CPD: revert a previous confirm — sends it back to pending_chief_cpd,
// undoing QA/VPAA/Admin's downstream actions (Dean's own confirm is left
// untouched, since it isn't Chief CPD's to undo). Same 'scheduled' guard as
// the Dean's revert.
router.patch('/:id/chief-cpd-revert', authenticate, authorize('chief_cpd'), async (req, res) => {
  try {
    const [[sub]] = await pool.query('SELECT status FROM submissions WHERE id = ?', [req.params.id])
    if (!sub) return res.status(404).json({ message: 'Submission not found.' })
    if (sub.status === 'scheduled') {
      return res.status(409).json({ message: 'A schedule has already been generated from this submission — an admin must clear it before you can revert.' })
    }
    const REVERTIBLE = new Set(['pending_qa', 'pending_vpaa', 'pending_admin', 'validated'])
    if (!REVERTIBLE.has(sub.status)) {
      return res.status(409).json({ message: `Cannot revert a submission that is currently ${sub.status.replace(/_/g, ' ')}.` })
    }
    await pool.query(
      `UPDATE submissions SET status = 'pending_chief_cpd',
         chief_cpd_action_at = NULL, qa_action_at = NULL, vpaa_action_at = NULL, admin_action_at = NULL
       WHERE id = ?`,
      [req.params.id]
    )
    res.json({ message: 'Submission reverted to Pending Chief CPD Review. QA, VPAA, and Admin will need to review it again.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Quality Assurance: all submissions at or past the QA stage (unscoped — university-wide)
router.get('/qa', authenticate, authorize('quality_assurance'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*,
        u.name       AS chair_name,
        u.department AS chair_dept,
        (SELECT COUNT(*) FROM submission_entries se WHERE se.submission_id = s.id) AS manual_entry_count,
        (SELECT COUNT(*) FROM faculty_load_entries fle
          WHERE fle.chair_id = s.chair_id
            AND fle.academic_year = s.academic_year
            AND fle.semester = s.semester) AS faculty_entry_count
      FROM submissions s
      JOIN users u ON s.chair_id = u.id
      WHERE s.status IN ('pending_qa', 'pending_vpaa', 'pending_admin', 'validated', 'scheduled', 'returned')
      ORDER BY
        FIELD(s.status, 'pending_qa', 'returned', 'pending_vpaa', 'pending_admin', 'validated', 'scheduled'),
        s.created_at DESC
    `)
    const mapped = rows.map(r => ({
      ...r,
      entry_count: r.submission_type === 'faculty_load' ? r.faculty_entry_count : r.manual_entry_count,
    }))
    res.json(mapped)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Quality Assurance: confirm or return
router.patch('/:id/qa', authenticate, authorize('quality_assurance'), async (req, res) => {
  const { action } = req.body
  const status = action === 'confirm' ? 'pending_vpaa' : 'returned'
  try {
    await pool.query('UPDATE submissions SET status = ?, qa_action_at = NOW() WHERE id = ?', [status, req.params.id])
    res.json({ message: `Submission ${status}.` })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Chair: check submission status for a specific term
router.get('/my-status', authenticate, authorize('chair'), async (req, res) => {
  const { year, semester } = req.query
  try {
    const [[row]] = await pool.query(
      `SELECT id, status, created_at, dean_action_at, chief_cpd_action_at, qa_action_at, vpaa_action_at, submission_type
       FROM submissions
       WHERE chair_id = ? AND academic_year = ? AND semester = ?
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, year, semester]
    )
    if (!row) return res.json(null)

    if (row.status === 'pending_instructor') {
      const [[{ total }]] = await pool.query(
        'SELECT COUNT(*) AS total FROM submission_confirmations WHERE submission_id = ?', [row.id]
      )
      const [[{ confirmed }]] = await pool.query(
        'SELECT COUNT(*) AS confirmed FROM submission_confirmations WHERE submission_id = ? AND confirmed_at IS NOT NULL', [row.id]
      )
      row.confirmations = { total, confirmed }
    }

    res.json(row)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Chair: get own submissions
router.get('/my', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.status, s.created_at, s.academic_year, s.semester, s.submission_type,
         (SELECT COUNT(*) FROM submission_entries se WHERE se.submission_id = s.id) AS entry_count
       FROM submissions s
       WHERE s.chair_id = ?
       ORDER BY s.created_at DESC
       LIMIT 10`,
      [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// VPAA: get all submissions with chair info + entry count
router.get('/vpaa', authenticate, authorize('vpaa'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*,
        u.name       AS chair_name,
        u.department AS chair_dept,
        (SELECT COUNT(*) FROM submission_entries se WHERE se.submission_id = s.id) AS manual_entry_count,
        (SELECT COUNT(*) FROM faculty_load_entries fle
          WHERE fle.chair_id = s.chair_id
            AND fle.academic_year = s.academic_year
            AND fle.semester = s.semester) AS faculty_entry_count
      FROM submissions s
      JOIN users u ON s.chair_id = u.id
      WHERE s.status IN ('pending_vpaa', 'pending_admin', 'validated', 'scheduled', 'returned')
      ORDER BY
        FIELD(s.status, 'pending_vpaa', 'returned', 'pending_admin', 'validated', 'scheduled'),
        s.created_at DESC
    `)
    const mapped = rows.map(r => ({
      ...r,
      entry_count: r.submission_type === 'faculty_load' ? r.faculty_entry_count : r.manual_entry_count,
    }))
    res.json(mapped)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// VPAA / Admin / Chair / Dean / Chief CPD / QA: get entries for a submission
router.get('/:id/entries', authenticate, authorize('vpaa', 'admin', 'chair', 'dean', 'chief_cpd', 'quality_assurance'), async (req, res) => {
  try {
    const [[sub]] = await pool.query('SELECT * FROM submissions WHERE id = ?', [req.params.id])
    if (!sub) return res.status(404).json({ message: 'Submission not found.' })

    if (sub.submission_type === 'faculty_load') {
      const [entries] = await pool.query(`
        SELECT fle.*,
          u.name       AS instructor_name,
          u.department AS instructor_dept
        FROM faculty_load_entries fle
        LEFT JOIN users u ON fle.assigned_instructor_id = u.id
        WHERE fle.chair_id = ? AND fle.academic_year = ? AND fle.semester = ?
        ORDER BY u.name, fle.sort_order, fle.id
      `, [sub.chair_id, sub.academic_year, sub.semester])
      return res.json({ type: 'faculty_load', academic_year: sub.academic_year, semester: sub.semester, entries })
    }

    const [entries] = await pool.query(`
      SELECT se.*, u.name AS instructor_name
      FROM submission_entries se
      JOIN users u ON se.instructor_id = u.id
      WHERE se.submission_id = ?
      ORDER BY se.id
    `, [req.params.id])
    res.json({ type: 'manual', entries })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// VPAA: endorse or return
router.patch('/:id/vpaa', authenticate, authorize('vpaa'), async (req, res) => {
  const { action } = req.body
  const status = action === 'endorse' ? 'pending_admin' : 'returned'
  try {
    await pool.query('UPDATE submissions SET status = ?, vpaa_action_at = NOW() WHERE id = ?', [status, req.params.id])
    res.json({ message: `Submission ${status}.` })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Admin: get all submissions (pending_admin first, then others)
router.get('/admin', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*,
        u.name       AS chair_name,
        u.department AS chair_dept,
        (SELECT COUNT(*) FROM submission_entries se WHERE se.submission_id = s.id) AS manual_entry_count,
        (SELECT COUNT(*) FROM faculty_load_entries fle
          WHERE fle.chair_id = s.chair_id
            AND fle.academic_year = s.academic_year
            AND fle.semester = s.semester) AS faculty_entry_count
      FROM submissions s
      JOIN users u ON s.chair_id = u.id
      WHERE s.status IN ('pending_admin', 'validated', 'scheduled', 'returned')
      ORDER BY
        FIELD(s.status, 'pending_admin', 'validated', 'scheduled', 'returned'),
        s.created_at DESC
    `)
    const mapped = rows.map(r => ({
      ...r,
      entry_count: r.submission_type === 'faculty_load' ? r.faculty_entry_count : r.manual_entry_count,
    }))
    res.json(mapped)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Admin: validate
router.patch('/:id/admin', authenticate, authorize('admin'), async (req, res) => {
  const { action } = req.body
  // 'revert' sends a 'scheduled' submission back to 'validated' — needed
  // because /scheduling/generate only picks up 'validated' submissions, so
  // after a schedule's already been generated once, regenerating (e.g. after
  // a scheduler fix, a room change, or new faculty load entries) requires
  // stepping back to 'validated' first. Only valid from 'scheduled'.
  if (action === 'revert') {
    const [[sub]] = await pool.query('SELECT status FROM submissions WHERE id = ?', [req.params.id])
    if (!sub) return res.status(404).json({ message: 'Submission not found.' })
    if (sub.status !== 'scheduled') {
      return res.status(400).json({ message: `Can only revert a submission that is currently Scheduled (this one is ${sub.status.replace(/_/g, ' ')}).` })
    }
    await pool.query('UPDATE submissions SET status = ? WHERE id = ?', ['validated', req.params.id])
    return res.json({ message: 'Submission reverted to Validated — ready to regenerate.' })
  }

  const status = action === 'validate' ? 'validated' : 'returned'
  try {
    await pool.query('UPDATE submissions SET status = ?, admin_action_at = NOW() WHERE id = ?', [status, req.params.id])
    res.json({ message: `Submission ${status}.` })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Admin/VPAA: delete a submission — for faculty_load submissions this also
// deletes that chair/term's faculty_load_entries (and any generated_schedules
// rows cascade-deleted with them). Manual submission_entries cascade via FK.
router.delete('/:id', authenticate, authorize('admin', 'vpaa'), async (req, res) => {
  const conn = await pool.getConnection()
  try {
    const [[sub]] = await conn.query('SELECT * FROM submissions WHERE id = ?', [req.params.id])
    if (!sub) {
      conn.release()
      return res.status(404).json({ message: 'Submission not found.' })
    }

    await conn.beginTransaction()

    let deletedEntries = 0
    if (sub.submission_type === 'faculty_load') {
      const [result] = await conn.query(
        'DELETE FROM faculty_load_entries WHERE chair_id = ? AND academic_year = ? AND semester = ?',
        [sub.chair_id, sub.academic_year, sub.semester]
      )
      deletedEntries = result.affectedRows
    }

    await conn.query('DELETE FROM submissions WHERE id = ?', [req.params.id])

    await conn.commit()
    res.json({ message: 'Submission deleted.', deletedEntries })
  } catch (err) {
    await conn.rollback()
    res.status(500).json({ message: 'Server error.', error: err.message })
  } finally {
    conn.release()
  }
})

export default router
