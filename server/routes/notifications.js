import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate } from '../middleware/auth.js'

/** The dashboard notification box — every role reads its own rows only. */
const router = Router()

// GET /api/notifications — latest 40 + how many are unread. For "load_assigned"
// items the linked swap's status is included so the box can show Confirm/Decline
// only while it's still waiting on the instructor.
router.get('/', authenticate, async (req, res) => {
  try {
    const [items] = await pool.query(
      `SELECT n.id, n.type, n.title, n.body, n.link, n.ref_id, n.flag, n.created_at, n.read_at,
              CASE WHEN n.type = 'load_assigned' THEN (SELECT lc.status FROM load_changes lc WHERE lc.id = n.ref_id) END AS action_status
       FROM notifications n WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 40`, [req.user.id]
    )
    const [[{ unread }]] = await pool.query('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.id])
    res.json({ items, unread })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/notifications/unread-count — cheap poll for the sidebar bell
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const [[{ unread }]] = await pool.query('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.id])
    res.json({ unread })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ? AND read_at IS NULL', [req.params.id, req.user.id])
    res.json({ message: 'Marked read.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/read-all', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [req.user.id])
    res.json({ message: 'All marked read.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
