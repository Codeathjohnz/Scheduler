/**
 * Seed: BSEd major in Mathematics (College of Teacher Education, dept "CTE")
 * — a Dean, a Program Chair, and a few Instructors, so the chair can log in
 * and upload the BSEd-Math prospectus next. No prospectus exists yet for
 * this department, so (unlike seed_instructors.js) this does not touch
 * instructor_specialties — there's nothing to assign specialties against.
 * Run: node create_bsed_math_users.js
 */
import bcrypt from 'bcryptjs'
import pool from './config/db.js'

const DEPARTMENT = 'CTE'   // College of Teacher Education — matches the
                            // acronym convention already used for CEIT/CCIS/CBPA

// Chair and Dean names taken directly from the BSEd-Math Program of Study's
// own signature block (Program Chairperson / Dean, College of Teacher
// Education) — not invented, so the account matches the real document.
const CHAIR = { username: 'chair_bsed', name: 'Sheila V. Paredes', password: 'chair123' }
const DEAN  = { username: 'dean_cte',   name: 'Mary Grace O. Reyes', password: 'dean123' }

// The prospectus lists no faculty roster, so these are placeholder Math
// instructors — rename/replace via Manage Users once real names are known.
const INSTRUCTORS = [
  { username: 'santos_bsed',    name: 'Prof. Ramon D. Santos',      password: 'santos123' },
  { username: 'delacruz_bsed',  name: 'Prof. Liza M. Dela Cruz',    password: 'delacruz123' },
  { username: 'ramos_bsed',     name: 'Prof. Edgar T. Ramos',       password: 'ramos123' },
  { username: 'bautista_bsed',  name: 'Prof. Cristina P. Bautista', password: 'bautista123' },
]

async function upsert({ username, name, password, role, department }) {
  const hash = await bcrypt.hash(password, 10)
  const [existing] = await pool.query('SELECT id FROM users WHERE username=?', [username])
  if (existing.length) {
    await pool.query('UPDATE users SET name=?, role=?, department=? WHERE username=?', [name, role, department, username])
    console.log(`Updated existing ${role}: ${name} (${username})`)
    return existing[0].id
  }
  const [r] = await pool.query(
    'INSERT INTO users (username, password_hash, name, role, department) VALUES (?,?,?,?,?)',
    [username, hash, name, role, department]
  )
  console.log(`Created ${role}: ${name} (${username}, id=${r.insertId})`)
  return r.insertId
}

async function seed() {
  await upsert({ ...CHAIR, role: 'chair', department: DEPARTMENT })
  await upsert({ ...DEAN, role: 'dean', department: DEPARTMENT })
  for (const inst of INSTRUCTORS) {
    await upsert({ ...inst, role: 'instructor', department: DEPARTMENT })
  }

  console.log('\nDone. Credentials:')
  console.log(`  [Program Chair] ${CHAIR.username} / ${CHAIR.password}`)
  console.log(`  [Dean]          ${DEAN.username} / ${DEAN.password}`)
  for (const i of INSTRUCTORS) console.log(`  [Instructor]    ${i.username} / ${i.password}`)

  await pool.end()
}

seed().catch(err => { console.error(err); process.exit(1) })
