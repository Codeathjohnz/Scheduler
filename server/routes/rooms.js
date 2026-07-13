import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'

const router = Router()

router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM rooms ORDER BY building, room_number')
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const { building, room_number, capacity, room_type, floor_level, is_accessible } = req.body
  try {
    const [result] = await pool.query(
      'INSERT INTO rooms (building, room_number, capacity, room_type, floor_level, is_accessible) VALUES (?,?,?,?,?,?)',
      [building, room_number, capacity, room_type, floor_level, is_accessible ? 1 : 0]
    )
    res.status(201).json({ id: result.insertId })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

const VALID_ROOM_TYPES = new Set(['Lecture', 'Laboratory', 'Special'])

// POST /api/rooms/bulk — spreadsheet import. body: { rooms: [{ building, room_number, capacity, room_type, floor_level, is_accessible }] }
// Re-importing the same building/room_number updates that row instead of failing (unique key: building + room_number).
router.post('/bulk', authenticate, authorize('admin'), async (req, res) => {
  const { rooms } = req.body
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return res.status(400).json({ message: 'rooms must be a non-empty array.' })
  }

  const cleaned = []
  for (const r of rooms) {
    const building = String(r.building || '').trim()
    const room_number = String(r.room_number || '').trim()
    if (!building || !room_number) continue
    const capacity = Math.max(1, parseInt(r.capacity, 10) || 40)
    const room_type = VALID_ROOM_TYPES.has(r.room_type) ? r.room_type : 'Lecture'
    const floor_level = Math.max(1, parseInt(r.floor_level, 10) || 1)
    const is_accessible = r.is_accessible ? 1 : 0
    cleaned.push([building, room_number, capacity, room_type, floor_level, is_accessible])
  }

  if (!cleaned.length) {
    return res.status(400).json({ message: 'No valid rows found (each row needs at least a building and room number).' })
  }

  try {
    await pool.query(
      `INSERT INTO rooms (building, room_number, capacity, room_type, floor_level, is_accessible)
       VALUES ?
       ON DUPLICATE KEY UPDATE capacity = VALUES(capacity), room_type = VALUES(room_type),
         floor_level = VALUES(floor_level), is_accessible = VALUES(is_accessible)`,
      [cleaned]
    )
    res.json({ message: 'Rooms imported.', count: cleaned.length, skipped: rooms.length - cleaned.length })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM rooms WHERE id = ?', [req.params.id])
    res.json({ message: 'Room deleted.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// Real-time availability
router.get('/availability', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.*,
        CASE WHEN s.room_id IS NOT NULL THEN 'occupied' ELSE 'available' END AS status
      FROM rooms r
      LEFT JOIN schedules s ON s.room_id = r.id
        AND s.status = 'approved'
        AND s.day_of_week = DAYNAME(NOW())
        AND NOW() BETWEEN CONCAT(CURDATE(), ' ', s.start_time) AND CONCAT(CURDATE(), ' ', s.end_time)
    `)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

export default router
