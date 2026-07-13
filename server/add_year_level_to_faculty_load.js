import pool from './config/db.js'

const [cols] = await pool.query(`SHOW COLUMNS FROM faculty_load_entries LIKE 'year_level'`)
if (cols.length === 0) {
  await pool.query(`ALTER TABLE faculty_load_entries ADD COLUMN year_level TINYINT AFTER program_yr_sec`)
  console.log('Added year_level column to faculty_load_entries.')
} else {
  console.log('year_level column already exists — nothing to do.')
}

await pool.end()
