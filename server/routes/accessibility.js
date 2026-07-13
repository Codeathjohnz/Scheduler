import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'

const router = Router()

// Instructor (or a Chair/Dean who also teaches): submit request
router.post('/', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  const { reason, details } = req.body
  try {
    await pool.query(
      'INSERT INTO accessibility_requests (instructor_id, reason, details, status, created_at) VALUES (?,?,?,"pending",NOW())',
      [req.user.id, reason, details]
    )
    res.status(201).json({ message: 'Accessibility request submitted.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Instructor (or a Chair/Dean who also teaches): check own request status
router.get('/my', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT * FROM accessibility_requests WHERE instructor_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.user.id]
    )
    res.json(row || null)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Admin: get all requests
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ar.*, u.name as instructor_name
      FROM accessibility_requests ar
      JOIN users u ON ar.instructor_id = u.id
      ORDER BY ar.created_at DESC
    `)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Admin: approve with level assignment
router.patch('/:id', authenticate, authorize('admin'), async (req, res) => {
  const { action, level } = req.body
  const status = action === 'approve' ? 'approved' : 'rejected'
  try {
    await pool.query(
      'UPDATE accessibility_requests SET status = ?, mobility_level = ?, reviewed_at = NOW() WHERE id = ?',
      [status, level || null, req.params.id]
    )
    if (status === 'approved') {
      const [[req_row]] = await pool.query('SELECT instructor_id FROM accessibility_requests WHERE id = ?', [req.params.id])
      await pool.query('UPDATE users SET mobility_level = ? WHERE id = ?', [level, req_row.instructor_id])
    }
    res.json({ message: `Request ${status}.` })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

export default router
