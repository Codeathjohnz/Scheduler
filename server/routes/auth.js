import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pool from '../config/db.js'

const router = Router()

// "I'm not a robot" check (Google reCAPTCHA v2). Only enforced once
// RECAPTCHA_SECRET_KEY is set; the site key is handed to the login page so it
// never has to be baked into the build.
router.get('/captcha-config', (req, res) => {
  res.json({ siteKey: process.env.RECAPTCHA_SITE_KEY || null })
})

async function captchaPasses(token, ip) {
  if (!process.env.RECAPTCHA_SECRET_KEY) return true
  if (!token) return false
  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: process.env.RECAPTCHA_SECRET_KEY, response: String(token), remoteip: ip || '' }),
    })
    const data = await r.json()
    return !!data.success
  } catch {
    return false
  }
}

router.post('/login', async (req, res) => {
  const { username, password, captcha } = req.body
  if (!(await captchaPasses(captcha, req.ip))) {
    return res.status(400).json({ message: 'Please confirm you are not a robot.' })
  }
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

// ── Google sign-in ───────────────────────────────────────────────────────────
// Only an institutional account gets in: the Google account must have a
// verified @adssu.edu.ph address AND that address must already belong to a
// user in this system (the Admin adds it on Manage Users). Anything else is
// turned away with a message, never silently created.
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — from the Google Cloud console
//   PUBLIC_URL (optional) — this site's address, e.g. https://adssu.example
const INSTITUTIONAL_DOMAIN = 'adssu.edu.ph'

function siteBase(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
}

// Sends the user to Google's sign-in page, limited to the ADSSU domain.
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.redirect('/login?error=' + encodeURIComponent('Google sign-in is not set up yet. Ask the Admin.'))
  }
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${siteBase(req)}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    hd: INSTITUTIONAL_DOMAIN,          // Google's hint: only this Workspace domain
    prompt: 'select_account',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

// Google sends the user back here with a code; we trade it for their identity.
router.get('/google/callback', async (req, res) => {
  const fail = (msg) => res.redirect('/login?error=' + encodeURIComponent(msg))
  if (req.query.error) return fail('Google sign-in was cancelled.')
  if (!req.query.code || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return fail('Google sign-in is not set up yet. Ask the Admin.')
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${siteBase(req)}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.id_token) return fail('Google sign-in failed. Please try again.')

    // The ID token came straight from Google over TLS in exchange for our secret,
    // so reading its claims here is sound; we check who it was issued for and who it's about.
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'))
    if (claims.aud !== process.env.GOOGLE_CLIENT_ID) return fail('Google sign-in failed. Please try again.')
    if (!claims.email_verified) return fail('Your Google email is not verified.')
    const email = String(claims.email || '').toLowerCase()
    if (!email.endsWith('@' + INSTITUTIONAL_DOMAIN)) {
      return fail('Use your institutional account (@adssu.edu.ph) to sign in.')
    }

    const [[user]] = await pool.query(
      'SELECT id, username, password_hash, role, name, department, section, programs, email, is_placeholder FROM users WHERE LOWER(email) = ? LIMIT 1',
      [email]
    )
    if (!user || user.is_placeholder) {
      return fail(`${email} is not registered in this system. Ask the Admin to add your account first.`)
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name, department: user.department, section: user.section },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    )
    const info = { id: user.id, username: user.username, role: user.role, name: user.name, department: user.department, section: user.section, programs: user.programs }
    // Handed to the login page in the URL fragment (never sent to the server again).
    const payload = Buffer.from(JSON.stringify({ token, user: info })).toString('base64url')
    res.redirect(`/login#google=${payload}`)
  } catch (err) {
    fail('Google sign-in failed. Please try again.')
  }
})

export default router
