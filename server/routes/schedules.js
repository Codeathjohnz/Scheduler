import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'

const router = Router()

// Get schedules (role-filtered)
router.get('/', authenticate, async (req, res) => {
  try {
    let query = `SELECT s.*, r.room_number, r.building, u.name as instructor_name
                 FROM schedules s
                 JOIN rooms r ON s.room_id = r.id
                 JOIN users u ON s.instructor_id = u.id`
    const params = []

    if (req.user.role === 'instructor') {
      query += ' WHERE s.instructor_id = ?'
      params.push(req.user.id)
    } else if (req.user.role === 'student') {
      query += ' WHERE s.section = ? AND s.status = "approved"'
      params.push(req.user.section)
    }

    const [rows] = await pool.query(query, params)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Admin: approve or reject a schedule entry
router.patch('/:id/approve', authenticate, authorize('admin'), async (req, res) => {
  const { action } = req.body
  const status = action === 'approve' ? 'approved' : 'rejected'
  try {
    await pool.query('UPDATE schedules SET status = ? WHERE id = ?', [status, req.params.id])
    res.json({ message: `Schedule ${status}.` })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

export default router
