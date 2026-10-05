import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'

const router = Router()

// GET all users (admin only)
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, name, role, department, section, programs, cross_dept_open, email, mobility_level, created_at FROM users WHERE is_placeholder = 0 ORDER BY role, name'
    )
    res.json(rows)
  } catch (err) {
    console.error('[GET /users] DB error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// Department/office is a free-text field (Manage Users has a datalist of
// suggestions, but nothing enforces picking one), and every department-scoped
// feature — My Specialty's prospectus lookup, Faculty Load's instructor
// picker, building priority — matches it by exact string equality against
// the department typed on the Program Chair/Dean's own account. A stray
// leading/trailing space (invisible in the UI) is a real, reported cause of
// "the instructor can't see the prospectus the chair uploaded": the chair's
// account reads "CEIT" and the instructor's reads "CEIT " and they silently
// never match. Collapsing to a single trimmed value at the point of entry
// stops new accounts from drifting; see the migrate.js step for existing ones.
// Accounts are institutional: the only email accepted is one at adssu.edu.ph
// (e.g. name@adssu.edu.ph). Empty is allowed here — the caller decides whether
// it's required. Returns { email, error }.
const INSTITUTIONAL_DOMAIN = '@adssu.edu.ph'
function checkEmail(val) {
  const email = String(val || '').trim().toLowerCase()
  if (!email) return { email: null, error: null }
  const local = email.slice(0, -INSTITUTIONAL_DOMAIN.length)
  if (!email.endsWith(INSTITUTIONAL_DOMAIN) || !/^[a-z0-9._-]+$/.test(local)) {
    return { email: null, error: 'Use an institutional email only, e.g. juan.delacruz@adssu.edu.ph.' }
  }
  return { email, error: null }
}

function cleanDept(val) {
  const trimmed = String(val || '').trim().replace(/\s+/g, ' ')
  return trimmed || null
}

// Programs an instructor teaches for within their department (e.g. BSIT, BSIS,
// or both), stored comma-separated. Empty = not restricted to any program.
function cleanPrograms(val) {
  const list = Array.isArray(val) ? val : String(val || '').split(',')
  const seen = new Set()
  const out = []
  for (const p of list.map(x => String(x).trim()).filter(Boolean)) {
    if (!seen.has(p.toUpperCase())) { seen.add(p.toUpperCase()); out.push(p) }
  }
  return out.length ? out.join(',') : null
}

// GET /api/users/program-options?department=CCIS — programs a department is
// known to have: every program its chairs have uploaded a prospectus for, plus
// any already assigned to that department's users (so a program someone
// typed in stays selectable for the next person).
router.get('/program-options', authenticate, async (req, res) => {
  const { department } = req.query
  if (!department) return res.json([])
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT p.program AS program FROM prospectus p
       JOIN users u ON p.uploaded_by = u.id WHERE u.department = ?`,
      [department]
    )
    const [userRows] = await pool.query(
      'SELECT programs FROM users WHERE department = ? AND programs IS NOT NULL', [department]
    )
    const seen = new Map()
    for (const r of rows) if (r.program) seen.set(r.program.toUpperCase(), r.program)
    for (const r of userRows) for (const p of r.programs.split(',')) if (p.trim()) seen.set(p.trim().toUpperCase(), p.trim())
    res.json([...seen.values()].sort())
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/users/me/programs — an instructor (or a chair/dean who also
// teaches) sets which programs they teach for. body: { programs: ['BSIT','BSIS'] }
router.put('/me/programs', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET programs = ? WHERE id = ?', [cleanPrograms(req.body.programs), req.user.id])
    res.json({ message: 'Programs saved.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT /api/users/me/cross-dept — say whether other departments' chairs may ask
// you to teach one of their subjects. body: { open: true|false }
router.put('/me/cross-dept', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET cross_dept_open = ? WHERE id = ?', [req.body.open ? 1 : 0, req.user.id])
    res.json({ message: 'Saved.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
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
      'SELECT id, username, name, role, department, section, programs, cross_dept_open, email, mobility_level, created_at FROM users WHERE id = ?',
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
  const { username, password, name, role, department, section, email, programs } = req.body

  if (!username || !password || !name || !role) {
    return res.status(400).json({ message: 'Username, password, name, and role are required.' })
  }
  const mail = checkEmail(email)
  if (mail.error) return res.status(400).json({ message: mail.error })

  const validRoles = ['admin', 'chair', 'vpaa', 'instructor', 'student', 'dean', 'quality_assurance', 'chief_cpd']
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role.' })
  }

  try {
    const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username])
    if (existing) return res.status(409).json({ message: 'Username already exists.' })

    const hash = await bcrypt.hash(password, 10)
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, name, role, department, section, programs, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, hash, name, role, cleanDept(department), section || null, cleanPrograms(programs), mail.email]
    )
    res.status(201).json({
      message: 'User created successfully.',
      user: { id: result.insertId, username, name, role, department: cleanDept(department), section, programs: cleanPrograms(programs), email: mail.email }
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// PUT update user (admin only)
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  const { name, role, department, section, email, password, programs } = req.body
  const mail = checkEmail(email)
  if (mail.error) return res.status(400).json({ message: mail.error })
  try {
    const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.id])
    if (!user) return res.status(404).json({ message: 'User not found.' })

    if (password) {
      const hash = await bcrypt.hash(password, 10)
      await pool.query(
        'UPDATE users SET name=?, role=?, department=?, section=?, programs=?, email=?, password_hash=? WHERE id=?',
        [name, role, cleanDept(department), section || null, cleanPrograms(programs), mail.email, hash, req.params.id]
      )
    } else {
      await pool.query(
        'UPDATE users SET name=?, role=?, department=?, section=?, programs=?, email=? WHERE id=?',
        [name, role, cleanDept(department), section || null, cleanPrograms(programs), mail.email, req.params.id]
      )
    }

    const [[updated]] = await pool.query(
      'SELECT id, username, name, role, department, section, programs, email FROM users WHERE id = ?',
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
    const [[user]] = await pool.query('SELECT id, name FROM users WHERE id = ?', [req.params.id])
    if (!user) return res.status(404).json({ message: 'User not found.' })

    // These three hold a whole department's real curriculum/schedule work,
    // not just this one person's own data — deleting the account would
    // either silently orphan them or (for the ones a user-delete can't
    // reach anyway) fail with a raw foreign-key error. Block with a clear
    // reason instead, naming exactly what's in the way.
    const [[blockers]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM prospectus WHERE uploaded_by = ?) AS prospectus,
         (SELECT COUNT(*) FROM faculty_load_entries WHERE chair_id = ?) AS faculty_load,
         (SELECT COUNT(*) FROM submissions WHERE chair_id = ?) AS submissions`,
      [req.params.id, req.params.id, req.params.id]
    )
    const reasons = []
    if (blockers.prospectus > 0) reasons.push(`${blockers.prospectus} uploaded prospectus${blockers.prospectus > 1 ? 'es' : ''}`)
    if (blockers.faculty_load > 0) reasons.push(`${blockers.faculty_load} faculty load entr${blockers.faculty_load > 1 ? 'ies' : 'y'}`)
    if (blockers.submissions > 0) reasons.push(`${blockers.submissions} submission${blockers.submissions > 1 ? 's' : ''}`)
    if (reasons.length) {
      return res.status(409).json({
        message: `${user.name} still has ${reasons.join(', ')} as Program Chair. Reassign or remove those first, then delete this account.`,
      })
    }

    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id])
    res.json({ message: 'User deleted.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// ── Bulk student import (registrar) ─────────────────────────────────────────
// The registrar uploads class-list spreadsheets; the client reads them and
// sends one row per student here. Each student gets a student account with a
// random starting password, returned once so the registrar can hand it out.
const STUDENT_PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
function randomPassword(len = 10) {
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (const b of bytes) out += STUDENT_PASSWORD_CHARS[b % STUDENT_PASSWORD_CHARS.length]
  return out
}
const DEPT_BY_PROGRAM = { BSIT: 'CCIS', BSIS: 'CCIS' }

// POST /api/users/import-students — body: { students: [{ student_id, last_name, first_name, middle_name, email, section }] }
router.post('/import-students', authenticate, authorize('admin'), async (req, res) => {
  const list = Array.isArray(req.body?.students) ? req.body.students : []
  if (!list.length) return res.status(400).json({ message: 'No students to import.' })
  if (list.length > 2000) return res.status(400).json({ message: 'Import at most 2,000 students at a time.' })

  const created = []
  const skipped = []
  try {
    for (const raw of list) {
      const email = String(raw.email || '').trim().toLowerCase()
      const section = String(raw.section || '').trim().replace(/-/g, ' ').replace(/\s+/g, ' ')
      const studentId = String(raw.student_id || '').trim() || email.split('@')[0]
      const label = `${studentId} ${raw.last_name || raw.name || ''}`.trim()
      // Class lists carry a name; account records carry only the email, so the
      // name is set from the record and can be corrected later on Manage Users.
      const hasName = raw.name || (raw.first_name && raw.last_name)
      if (!hasName) { skipped.push({ label, reason: 'Missing name.' }); continue }
      if (!/^[a-z0-9._-]+@adssu\.edu\.ph$/.test(email)) { skipped.push({ label, reason: `Not an institutional email (${email || 'none'}).` }); continue }
      const username = email.slice(0, email.indexOf('@'))

      const [[dupe]] = await pool.query('SELECT id FROM users WHERE username = ? OR LOWER(email) = ? LIMIT 1', [username, email])
      if (dupe) { skipped.push({ label, reason: 'An account with this email or username already exists.' }); continue }

      const program = (section.split(' ')[0] || '').toUpperCase()
      const name = raw.name
        ? String(raw.name).trim()
        : [raw.first_name, raw.middle_name, raw.last_name].map(x => String(x || '').trim()).filter(Boolean).join(' ')
      // A department given with the row (from the program's Program Chair) wins over the built-in mapping.
      const dept = cleanDept(raw.department) || DEPT_BY_PROGRAM[program] || null
      const password = randomPassword()
      const hash = await bcrypt.hash(password, 10)
      await pool.query(
        'INSERT INTO users (username, password_hash, name, role, department, section, email) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [username, hash, name, 'student', dept, section || null, email]
      )
      created.push({ student_id: studentId, name, username, email, section, password })
    }
    res.json({ created, skipped })
  } catch (err) {
    res.status(500).json({ message: err.message, created, skipped })
  }
})

export default router
