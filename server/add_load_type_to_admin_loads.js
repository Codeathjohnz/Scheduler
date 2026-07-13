import pool from './config/db.js'

const [cols] = await pool.query(`SHOW COLUMNS FROM faculty_admin_loads LIKE 'load_type'`)
if (cols.length === 0) {
  await pool.query(`
    ALTER TABLE faculty_admin_loads
    ADD COLUMN load_type ENUM('administrative','research','extension','project') NOT NULL DEFAULT 'administrative' AFTER lab_hours
  `)
  console.log('Added load_type column to faculty_admin_loads.')
} else {
  console.log('load_type column already exists — nothing to do.')
}

await pool.end()
