import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'

const router = Router()

// GET /api/building-priorities — { [building]: [{ program, priority }, ...] } ordered 1..n
router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT building, program, priority FROM building_priorities ORDER BY building, priority'
    )
    const grouped = {}
    for (const r of rows) {
      if (!grouped[r.building]) grouped[r.building] = []
      grouped[r.building].push({ program: r.program, priority: r.priority })
    }
    res.json(grouped)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/building-priorities/:building — replace the ranked program list for a building
// body: { programs: ['CEIT', 'CCIS', ...] } — array order defines priority (1 = first)
router.put('/:building', authenticate, authorize('admin'), async (req, res) => {
  const { building } = req.params
  const { programs } = req.body
  if (!Array.isArray(programs)) {
    return res.status(400).json({ message: 'programs must be an array.' })
  }
  const cleaned = [...new Set(programs.map(p => String(p).trim()).filter(Boolean))]

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM building_priorities WHERE building = ?', [building])
    if (cleaned.length) {
      const rows = cleaned.map((program, i) => [building, program, i + 1])
      await conn.query(
        'INSERT INTO building_priorities (building, program, priority) VALUES ?',
        [rows]
      )
    }
    await conn.commit()
    res.json({ building, programs: cleaned })
  } catch (err) {
    await conn.rollback()
    res.status(500).json({ message: 'Server error.', error: err.message })
  } finally {
    conn.release()
  }
})

export default router
