import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'

const router = Router()

const VALID_LOAD_TYPES = new Set(['administrative', 'research', 'extension', 'project', 'consultation', 'lesson_prep'])

// Consultation and Lesson Preparation are hours-only — no title, no unit credit,
// just a weekly hours figure. They never count toward the 21/27 unit-credit cap
// (their faculty_admin_loads.units is always 0).
const HOURS_ONLY_TYPES = new Set(['consultation', 'lesson_prep'])
const HOURS_ONLY_LABEL = { consultation: 'Consultation', lesson_prep: 'Lesson Preparation' }

// Total weekly Contact Hours (teaching contact hours + Consultation + Lesson
// Prep) may never exceed this when approving an hours-only request.
const CONTACT_HRS_MAX = 40

// Instructor: submit a load request
router.post('/', authenticate, authorize('instructor'), async (req, res) => {
  const { academic_year, semester, load_type, description, units, hours } = req.body
  if (!academic_year || !semester) {
    return res.status(400).json({ message: 'Academic year and semester are required.' })
  }
  if (!VALID_LOAD_TYPES.has(load_type)) {
    return res.status(400).json({ message: 'Invalid load type.' })
  }

  const isHoursOnly = HOURS_ONLY_TYPES.has(load_type)
  if (isHoursOnly) {
    if (!hours || Number(hours) <= 0) {
      return res.status(400).json({ message: 'Hours is required.' })
    }
  } else {
    if (!description || !String(description).trim()) {
      return res.status(400).json({ message: 'Title is required.' })
    }
    if (!units || Number(units) <= 0) {
      return res.status(400).json({ message: 'Unit credit is required.' })
    }
  }

  const finalDescription = isHoursOnly ? HOURS_ONLY_LABEL[load_type] : description.trim()
  const finalUnits = isHoursOnly ? 0 : units
  const finalHours = isHoursOnly ? Number(hours) : null

  try {
    await pool.query(
      `INSERT INTO load_requests (instructor_id, academic_year, semester, load_type, description, units, hours, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [req.user.id, academic_year, semester, load_type, finalDescription, finalUnits, finalHours]
    )
    res.status(201).json({ message: 'Load request submitted for chair review.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Instructor: view own requests
router.get('/my', authenticate, authorize('instructor'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM load_requests WHERE instructor_id = ? ORDER BY created_at DESC',
      [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Chair: view requests from instructors in their department (or General Education)
router.get('/', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [[chair]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    const dept = chair?.department
    const deptFilter = dept ? "AND (u.department = ? OR u.department = 'General Education')" : ''
    const params = dept ? [dept] : []
    const [rows] = await pool.query(`
      SELECT lr.*, u.name AS instructor_name, u.department AS instructor_dept
      FROM load_requests lr
      JOIN users u ON lr.instructor_id = u.id
      WHERE u.role = 'instructor' ${deptFilter}
      ORDER BY FIELD(lr.status, 'pending', 'approved', 'rejected'), lr.created_at DESC
    `, params)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Chair: approve or reject — approving also creates the real faculty_admin_loads row
router.patch('/:id', authenticate, authorize('chair'), async (req, res) => {
  const { action } = req.body
  const status = action === 'approve' ? 'approved' : 'rejected'
  const conn = await pool.getConnection()
  try {
    const [[reqRow]] = await conn.query('SELECT * FROM load_requests WHERE id = ?', [req.params.id])
    if (!reqRow) {
      conn.release()
      return res.status(404).json({ message: 'Load request not found.' })
    }
    if (reqRow.status !== 'pending') {
      conn.release()
      return res.status(409).json({ message: `Request already ${reqRow.status}.` })
    }

    // Approving Consultation/Lesson Prep must not push total weekly Contact
    // Hours (teaching + already-approved hours-only load + this request) past
    // the 40-hour cap.
    if (status === 'approved' && HOURS_ONLY_TYPES.has(reqRow.load_type)) {
      const [[teach]] = await conn.query(
        `SELECT COALESCE(SUM(lec_hours + lab_hours), 0) AS total FROM faculty_load_entries
         WHERE assigned_instructor_id = ? AND academic_year = ? AND semester = ?`,
        [reqRow.instructor_id, reqRow.academic_year, reqRow.semester]
      )
      const [[existing]] = await conn.query(
        `SELECT COALESCE(SUM(hours), 0) AS total FROM faculty_admin_loads
         WHERE instructor_id = ? AND academic_year = ? AND semester = ?
           AND load_type IN ('consultation', 'lesson_prep')`,
        [reqRow.instructor_id, reqRow.academic_year, reqRow.semester]
      )
      const projected = Number(teach.total) + Number(existing.total) + Number(reqRow.hours)
      if (projected > CONTACT_HRS_MAX) {
        conn.release()
        return res.status(409).json({
          message: `Approving this would bring total Contact Hours to ${projected}, over the ${CONTACT_HRS_MAX}-hour maximum.`,
        })
      }
    }

    await conn.beginTransaction()

    await conn.query(
      'UPDATE load_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [status, req.user.id, req.params.id]
    )

    if (status === 'approved') {
      await conn.query(
        `INSERT INTO faculty_admin_loads (instructor_id, academic_year, semester, description, units, hours, lec_hours, lab_hours, load_type, chair_id)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        [reqRow.instructor_id, reqRow.academic_year, reqRow.semester, reqRow.description, reqRow.units, reqRow.hours, reqRow.load_type, req.user.id]
      )
    }

    await conn.commit()
    res.json({ message: `Request ${status}.` })
  } catch (err) {
    await conn.rollback()
    res.status(500).json({ message: 'Server error.', error: err.message })
  } finally {
    conn.release()
  }
})

export default router
