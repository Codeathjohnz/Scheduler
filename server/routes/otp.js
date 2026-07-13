import { Router } from 'express'
import bcrypt from 'bcryptjs'
import pool from '../config/db.js'
import { authenticate } from '../middleware/auth.js'
import { sendOTPEmail } from '../config/mailer.js'

const router = Router()

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// POST /api/otp/send  — logged-in user requests OTP sent to their email
router.post('/send', authenticate, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT id, name, email FROM users WHERE id = ?',
      [req.user.id]
    )
    if (!user) return res.status(404).json({ message: 'User not found.' })
    if (!user.email) {
      return res.status(400).json({ message: 'No email address on file. Ask the Admin to add your email first.' })
    }

    // Invalidate any existing unused OTPs for this user
    await pool.query(
      'UPDATE otp_codes SET used = 1 WHERE user_id = ? AND used = 0',
      [user.id]
    )

    const otp = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await pool.query(
      'INSERT INTO otp_codes (user_id, otp_code, expires_at) VALUES (?, ?, ?)',
      [user.id, otp, expiresAt]
    )

    await sendOTPEmail(user.email, user.name, otp)

    res.json({ message: `OTP sent to ${maskEmail(user.email)}` })
  } catch (err) {
    console.error('OTP send error:', err)
    res.status(500).json({ message: 'Failed to send OTP. Check server email configuration.', error: err.message })
  }
})

// POST /api/otp/verify  — verify OTP only (returns a short-lived change token)
router.post('/verify', authenticate, async (req, res) => {
  const { otp } = req.body
  if (!otp) return res.status(400).json({ message: 'OTP is required.' })

  try {
    const [[record]] = await pool.query(
      `SELECT * FROM otp_codes
       WHERE user_id = ? AND otp_code = ? AND used = 0 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, otp]
    )

    if (!record) {
      return res.status(400).json({ message: 'Invalid or expired OTP. Please request a new one.' })
    }

    // Mark OTP as used
    await pool.query('UPDATE otp_codes SET used = 1 WHERE id = ?', [record.id])

    res.json({ message: 'OTP verified.', verified: true })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

// POST /api/otp/change-password  — change password (user must have verified OTP in same session)
router.post('/change-password', authenticate, async (req, res) => {
  const { otp, newPassword } = req.body

  if (!otp || !newPassword) {
    return res.status(400).json({ message: 'OTP and new password are required.' })
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' })
  }

  try {
    const [[record]] = await pool.query(
      `SELECT * FROM otp_codes
       WHERE user_id = ? AND otp_code = ? AND used = 1 AND expires_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, otp]
    )

    if (!record) {
      return res.status(400).json({ message: 'OTP verification required. Please start over.' })
    }

    const hash = await bcrypt.hash(newPassword, 10)
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id])

    // Clean up old OTP records for this user
    await pool.query('DELETE FROM otp_codes WHERE user_id = ?', [req.user.id])

    res.json({ message: 'Password changed successfully.' })
  } catch (err) {
    res.status(500).json({ message: 'Server error.', error: err.message })
  }
})

function maskEmail(email) {
  const [local, domain] = email.split('@')
  const masked = local.length <= 3
    ? local[0] + '***'
    : local.slice(0, 2) + '***' + local.slice(-1)
  return `${masked}@${domain}`
}

export default router
