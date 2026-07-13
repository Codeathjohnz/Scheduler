import pool from './config/db.js'

await pool.query(`
  CREATE TABLE IF NOT EXISTS section_counts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chair_id INT NOT NULL,
    academic_year VARCHAR(20) NOT NULL,
    semester TINYINT NOT NULL,
    year_level TINYINT NOT NULL,
    section_count TINYINT NOT NULL DEFAULT 1,
    UNIQUE KEY uq_section_count (chair_id, academic_year, semester, year_level),
    FOREIGN KEY (chair_id) REFERENCES users(id)
  )
`)

console.log('section_counts table created.')
await pool.end()
