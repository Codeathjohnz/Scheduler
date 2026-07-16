import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
dotenv.config()

const users = [
  { username: 'admin',      password: 'admin123',  role: 'admin',      name: 'Ana Cruz',        department: "Registrar's Office" },
  { username: 'chair',      password: 'chair123',  role: 'chair',      name: 'Maria Santos',    department: 'CEIT' },
  { username: 'dean',       password: 'dean123',   role: 'dean',       name: 'Dr. Ramon Flores', department: 'CCIS' },
  { username: 'chiefcpd',   password: 'chiefcpd123', role: 'chief_cpd', name: 'Dr. Corazon Villanueva', department: 'Office of Curriculum Planning and Development' },
  { username: 'qa',         password: 'qa123',     role: 'quality_assurance', name: 'Dr. Liza Marfil', department: 'Office of Quality Assurance' },
  { username: 'vpaa',       password: 'vpaa123',   role: 'vpaa',       name: 'Dr. Juan Reyes',  department: 'Office of the VPAA' },
  { username: 'instructor', password: 'instr123',  role: 'instructor', name: 'Michelle Elape',  department: 'CEIT' },
  { username: 'student',    password: 'stud123',   role: 'student',    name: 'John Dela Cruz',  department: 'BSIS 1A', section: 'BSIS 1A' },
]

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

console.log('Seeding users with correct password hashes...')

for (const u of users) {
  const hash = await bcrypt.hash(u.password, 10)
  await pool.query(
    `INSERT INTO users (username, password_hash, role, name, department, section)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = ?, name = ?, department = ?, section = ?`,
    [u.username, hash, u.role, u.name, u.department, u.section || null,
     hash, u.name, u.department, u.section || null]
  )
  console.log(`  ✓ ${u.role.padEnd(12)} ${u.username} / ${u.password}`)
}

console.log('\nDone! All users seeded.')
await pool.end()
