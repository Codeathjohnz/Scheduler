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

// Comma-separated list of programs/departments allowed to use a room (e.g.
// "CCIS,BSIT,BSIS") — trimmed and re-joined so it stores consistently;
// null/empty means open to everyone (unchanged default behavior).
function cleanProgramRestriction(val) {
  if (!val) return null
  const list = String(val).split(',').map(s => s.trim()).filter(Boolean)
  return list.length ? list.join(',') : null
}

// A stray leading/trailing space (or a doubled internal space) typed into
// Building or Room No. makes two rows that render identically in the UI but
// are different room_ids to the scheduler and its conflict checks — two
// classes can then land in what looks like "the same room, same time" with
// nothing catching it, because uq_room (building, room_number) only rejects
// an EXACT duplicate string. Trimming here closes that off for single-room
// add/edit the same way the bulk spreadsheet import already does.
function cleanRoomField(val) {
  return String(val || '').trim().replace(/\s+/g, ' ')
}

router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const building = cleanRoomField(req.body.building)
  const room_number = cleanRoomField(req.body.room_number)
  const { capacity, room_type, floor_level, is_accessible, program_restriction } = req.body
  try {
    const [result] = await pool.query(
      'INSERT INTO rooms (building, room_number, capacity, room_type, floor_level, is_accessible, program_restriction) VALUES (?,?,?,?,?,?,?)',
      [building, room_number, capacity, room_type, floor_level, is_accessible ? 1 : 0, cleanProgramRestriction(program_restriction)]
    )
    res.status(201).json({ id: result.insertId })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: `${building} ${room_number} already exists — edit that room instead of adding it again.` })
    }
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/rooms/:id — edit an existing room (previously create/delete only)
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  const building = cleanRoomField(req.body.building)
  const room_number = cleanRoomField(req.body.room_number)
  const { capacity, room_type, floor_level, is_accessible, program_restriction } = req.body
  try {
    const [result] = await pool.query(
      `UPDATE rooms SET building=?, room_number=?, capacity=?, room_type=?, floor_level=?, is_accessible=?, program_restriction=?
       WHERE id=?`,
      [building, room_number, capacity, room_type, floor_level, is_accessible ? 1 : 0, cleanProgramRestriction(program_restriction), req.params.id]
    )
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Room not found.' })
    }
    res.json({ message: 'Room updated.' })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: `${building} ${room_number} already exists — that's a different room.` })
    }
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

const VALID_ROOM_TYPES = new Set(['Lecture', 'Laboratory', 'Special', 'Gym'])

// POST /api/rooms/bulk — spreadsheet import. body: { rooms: [{ building, room_number, capacity, room_type, floor_level, is_accessible }] }
// Re-importing the same building/room_number updates that row instead of failing (unique key: building + room_number).
router.post('/bulk', authenticate, authorize('admin'), async (req, res) => {
  const { rooms } = req.body
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return res.status(400).json({ message: 'rooms must be a non-empty array.' })
  }

  const cleaned = []
  for (const r of rooms) {
    const building = cleanRoomField(r.building)
    const room_number = cleanRoomField(r.room_number)
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
