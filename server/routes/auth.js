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
    if (!user) return res.status(401).json({ message: 'Invalid credentials.' })

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ message: 'Invalid credentials.' })

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name, department: user.department, section: user.section },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    )
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.name, department: user.department, section: user.section } })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

export default router
