import { Router } from 'express'
import bcrypt from 'bcryptjs'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'

const router = Router()

// GET all users (admin only)
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, name, role, department, section, email, mobility_level, created_at FROM users ORDER BY role, name'
    )
    res.json(rows)
  } catch (err) {
    console.error('[GET /users] DB error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// Dean/VPAA/Chief CPD e-signature — a small PNG uploaded once, stored as a
// data URI and attached to the Faculty Loading DOCX export once they
// confirm a submission (see server/utils/facultyLoadingDocx.js). Registered
// before the generic '/:id' routes below so 'signature' is never captured
// as an :id.
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024   // 2MB decoded

// GET /api/users/signature — own current signature (for the upload preview)
router.get('/signature', authenticate, authorize('dean', 'vpaa', 'chief_cpd'), async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT signature_image FROM users WHERE id = ?', [req.user.id])
    res.json({ signature_image: row?.signature_image || null })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/users/signature — body: { data: "data:image/png;base64,..." }
router.put('/signature', authenticate, authorize('dean', 'vpaa', 'chief_cpd'), async (req, res) => {
  const { data } = req.body
  // PNG only — supports transparency (needed so the signature reads
  // cleanly over the printed line rather than as a white rectangle) and
  // is already a declared content type in the DOCX template, so embedding
  // it later needs no extra template edits.
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(data || '')
  if (!match) {
    return res.status(400).json({ message: 'Please upload a PNG image (transparent background recommended).' })
  }
  const decodedSize = Buffer.byteLength(match[1], 'base64')
  if (decodedSize > MAX_SIGNATURE_BYTES) {
    return res.status(400).json({ message: 'Signature image is too large (max 2MB).' })
  }
  try {
    await pool.query('UPDATE users SET signature_image = ? WHERE id = ?', [data, req.user.id])
    res.json({ message: 'Signature saved.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// DELETE /api/users/signature
router.delete('/signature', authenticate, authorize('dean', 'vpaa', 'chief_cpd'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET signature_image = NULL WHERE id = ?', [req.user.id])
    res.json({ message: 'Signature removed.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// GET single user
router.get('/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== +req.params.id) {
    return res.status(403).json({ message: 'Access denied.' })
  }
  try {
    const [[user]] = await pool.query(
      'SELECT id, username, name, role, department, section, email, mobility_level, created_at FROM users WHERE id = ?',
      [req.params.id]
    )
    if (!user) return res.status(404).json({ message: 'User not found.' })
    res.json(user)
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST create user (admin only)
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const { username, password, name, role, department, section, email } = req.body

  if (!username || !password || !name || !role) {
    return res.status(400).json({ message: 'Username, password, name, and role are required.' })
  }

  const validRoles = ['admin', 'chair', 'vpaa', 'instructor', 'student', 'dean', 'quality_assurance', 'chief_cpd']
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role.' })
  }

  try {
    const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username])
    if (existing) return res.status(409).json({ message: 'Username already exists.' })

    const hash = await bcrypt.hash(password, 10)
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, name, role, department, section, email) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [username, hash, name, role, department || null, section || null, email || null]
    )
    res.status(201).json({
      message: 'User created successfully.',
      user: { id: result.insertId, username, name, role, department, section, email }
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT update user (admin only)
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  const { name, role, department, section, email, password } = req.body
  try {
    const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.id])
    if (!user) return res.status(404).json({ message: 'User not found.' })

    if (password) {
      const hash = await bcrypt.hash(password, 10)
      await pool.query(
        'UPDATE users SET name=?, role=?, department=?, section=?, email=?, password_hash=? WHERE id=?',
        [name, role, department || null, section || null, email || null, hash, req.params.id]
      )
    } else {
      await pool.query(
        'UPDATE users SET name=?, role=?, department=?, section=?, email=? WHERE id=?',
        [name, role, department || null, section || null, email || null, req.params.id]
      )
    }

    const [[updated]] = await pool.query(
      'SELECT id, username, name, role, department, section, email FROM users WHERE id = ?',
      [req.params.id]
    )
    res.json({ message: 'User updated.', user: updated })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// DELETE user (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  if (+req.params.id === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own account.' })
  }
  try {
    const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.id])
    if (!user) return res.status(404).json({ message: 'User not found.' })
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id])
    res.json({ message: 'User deleted.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

export default router
