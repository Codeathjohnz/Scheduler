/**
 * Seed: CCIS instructors + GE instructors with pre-set specialties
 * Run: node seed_instructors.js
 */
import bcrypt from 'bcryptjs'
import pool from './config/db.js'

/* ── GE subject detector ──────────────────────────────────────────────────── */
// Course codes that belong to General Education (not IT/CS core subjects)
const GE_PREFIXES = [
  'GE', 'GNED', 'NSTP', 'PE', 'PATH', 'PHED',
  'MATH', 'MTH',
  'COMM', 'ENGL', 'ENG',
  'FIL',
  'HIST', 'HIS',
  'SOC', 'STS', 'SOCSCI',
  'ART', 'ARTS',
  'SCI',
  'RIZAL', 'RIZ',
  'ETHICS', 'PHILO', 'PHIED',
]

function isGESubject(code) {
  const upper = (code || '').toUpperCase().replace(/[\s-]/g, '')
  return GE_PREFIXES.some(p => upper.startsWith(p))
}

/* ── Instructor definitions ──────────────────────────────────────────────── */
const CCIS_INSTRUCTORS = [
  { username: 'ringanio',   name: 'Regino A. Ringanio',     password: 'ringanio123' },
  { username: 'cabalida',   name: 'Claire M. Cabalida',     password: 'cabalida123' },
  { username: 'espinosa',   name: 'Erwin D. Espinosa',      password: 'espinosa123' },
  { username: 'dagondon',   name: 'Dinah P. Dagondon',      password: 'dagondon123' },
]

const GE_INSTRUCTORS = [
  { username: 'lapasaran',  name: 'Leonisa B. Lapasaran',   password: 'lapasaran123' },
  { username: 'gabucan',    name: 'Gracelyn T. Gabucan',    password: 'gabucan123' },
]

/* ── Main ───────────────────────────────────────────────────────────────── */
async function seed() {
  // 1. Get all prospectus subjects
  const [subjects] = await pool.query('SELECT * FROM prospectus_subjects ORDER BY year_level, semester, id')
  if (!subjects.length) {
    console.log('No prospectus subjects found. Upload a prospectus first, then re-run this seed.')
    await pool.end(); return
  }

  const geSubjects   = subjects.filter(s => isGESubject(s.course_code))
  const coreSubjects = subjects.filter(s => !isGESubject(s.course_code))

  console.log(`Prospectus: ${subjects.length} total — ${coreSubjects.length} IT/CS core, ${geSubjects.length} GE`)

  // 2. Create / update CCIS instructors
  const ccisIds = []
  for (const inst of CCIS_INSTRUCTORS) {
    const hash = await bcrypt.hash(inst.password, 10)
    const [existing] = await pool.query('SELECT id FROM users WHERE username=?', [inst.username])
    let id
    if (existing.length) {
      await pool.query('UPDATE users SET name=?, department=? WHERE username=?', [inst.name, 'CCIS', inst.username])
      id = existing[0].id
      console.log(`Updated existing CCIS instructor: ${inst.name}`)
    } else {
      const [r] = await pool.query(
        'INSERT INTO users (username, password_hash, name, role, department) VALUES (?,?,?,?,?)',
        [inst.username, hash, inst.name, 'instructor', 'CCIS']
      )
      id = r.insertId
      console.log(`Created CCIS instructor: ${inst.name} (id=${id})`)
    }
    ccisIds.push(id)
  }

  // 3. Create / update GE instructors
  const geIds = []
  for (const inst of GE_INSTRUCTORS) {
    const hash = await bcrypt.hash(inst.password, 10)
    const [existing] = await pool.query('SELECT id FROM users WHERE username=?', [inst.username])
    let id
    if (existing.length) {
      await pool.query('UPDATE users SET name=?, department=? WHERE username=?', [inst.name, 'General Education', inst.username])
      id = existing[0].id
      console.log(`Updated existing GE instructor: ${inst.name}`)
    } else {
      const [r] = await pool.query(
        'INSERT INTO users (username, password_hash, name, role, department) VALUES (?,?,?,?,?)',
        [inst.username, hash, inst.name, 'instructor', 'General Education']
      )
      id = r.insertId
      console.log(`Created GE instructor: ${inst.name} (id=${id})`)
    }
    geIds.push(id)
  }

  // 4. Assign CCIS instructors to core (IT/CS) subjects — distribute evenly
  // Clear existing specialties for these instructors first
  if (ccisIds.length) {
    await pool.query('DELETE FROM instructor_specialties WHERE instructor_id IN (?)', [ccisIds])
  }
  if (coreSubjects.length && ccisIds.length) {
    // Give EVERY CCIS instructor all core subjects (they all can teach IT)
    // — but split: each instructor gets subjects from different years
    const rows = []
    coreSubjects.forEach((sub, idx) => {
      // Round-robin assignment: each instructor gets ~25% of subjects
      const instructorIdx = idx % ccisIds.length
      rows.push([ccisIds[instructorIdx], sub.id])
    })
    // Also give instructor[0] first half and instructor[1] second half etc.
    // Actually give ALL instructors the subjects they CAN teach by year level
    // Simpler: give each instructor subjects from 2 year levels
    const rows2 = []
    for (let i = 0; i < ccisIds.length; i++) {
      const assignedYears = []
      // Distribute year levels: inst0→yr1+2, inst1→yr2+3, inst2→yr3+4, inst3→yr1+4
      const yearSets = [
        [1, 2], [2, 3], [3, 4], [1, 4]
      ]
      const myYears = yearSets[i] || [1, 2, 3, 4]
      coreSubjects
        .filter(s => myYears.includes(s.year_level))
        .forEach(s => rows2.push([ccisIds[i], s.id]))
    }
    if (rows2.length) {
      await pool.query('INSERT IGNORE INTO instructor_specialties (instructor_id, subject_id) VALUES ?', [rows2])
      console.log(`Assigned specialties to ${ccisIds.length} CCIS instructors (${rows2.length} entries)`)
    }
  }

  // 5. Assign GE instructors to GE subjects (all GE subjects to all GE instructors)
  if (geIds.length) {
    await pool.query('DELETE FROM instructor_specialties WHERE instructor_id IN (?)', [geIds])
  }
  if (geSubjects.length && geIds.length) {
    const rows = []
    for (const gid of geIds) {
      for (const sub of geSubjects) {
        rows.push([gid, sub.id])
      }
    }
    await pool.query('INSERT IGNORE INTO instructor_specialties (instructor_id, subject_id) VALUES ?', [rows])
    console.log(`Assigned ${geSubjects.length} GE subjects to ${geIds.length} GE instructors`)
  } else if (geSubjects.length === 0) {
    console.log('No GE subjects found in prospectus (no course codes matching GE prefixes).')
    console.log('GE instructors created but have no specialty yet — they can set it via My Specialty page.')
    // Give GE instructors ALL subjects so they appear as candidates for any subject
    if (geIds.length && subjects.length) {
      const rows = []
      for (const gid of geIds) {
        for (const sub of subjects) rows.push([gid, sub.id])
      }
      await pool.query('INSERT IGNORE INTO instructor_specialties (instructor_id, subject_id) VALUES ?', [rows])
      console.log(`Fallback: assigned ALL ${subjects.length} subjects to GE instructors as specialty.`)
    }
  }

  console.log('\nDone. Credentials:')
  ;[...CCIS_INSTRUCTORS, ...GE_INSTRUCTORS].forEach(i => console.log(`  ${i.username} / ${i.password}`))

  await pool.end()
}

seed().catch(err => { console.error(err); process.exit(1) })
