import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pool from '../config/db.js'

const router = Router()

router.post('/login', async (req, res) => {
  const { username, password } = req.body
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    const user = rows[0]
    // Placeholders ("Instructor A") aren't people and have no usable password.
    if (!user || user.is_placeholder) return res.status(401).json({ message: 'Invalid credentials.' })

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ message: 'Invalid credentials.' })

    // 30 days, not a single work shift — this is an internal scheduling tool
    // with no refresh-token flow and no auto-logout-on-401 handling on the
    // client, so a short expiry only ever surfaces as an unexplained forced
    // logout mid-session. Session stays open until someone clicks Logout.
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name, department: user.department, section: user.section },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    )
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.name, department: user.department, section: user.section, programs: user.programs } })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

export default router
