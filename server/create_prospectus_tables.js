import pool from './config/db.js'

await pool.query(`
  CREATE TABLE IF NOT EXISTS prospectus (
    id INT AUTO_INCREMENT PRIMARY KEY,
    program VARCHAR(100) NOT NULL DEFAULT 'BSIT',
    academic_year VARCHAR(20),
    filename VARCHAR(255),
    uploaded_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  )
`)

await pool.query(`
  CREATE TABLE IF NOT EXISTS prospectus_subjects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    prospectus_id INT NOT NULL,
    course_code VARCHAR(40) NOT NULL,
    descriptive_title VARCHAR(250) NOT NULL,
    units FLOAT DEFAULT 0,
    lec_hours FLOAT DEFAULT 0,
    lab_hours FLOAT DEFAULT 0,
    year_level TINYINT NOT NULL,
    semester TINYINT NOT NULL,
    prerequisite VARCHAR(250),
    FOREIGN KEY (prospectus_id) REFERENCES prospectus(id) ON DELETE CASCADE
  )
`)

await pool.query(`
  CREATE TABLE IF NOT EXISTS instructor_specialties (
    id INT AUTO_INCREMENT PRIMARY KEY,
    instructor_id INT NOT NULL,
    subject_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_specialty (instructor_id, subject_id),
    FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES prospectus_subjects(id) ON DELETE CASCADE
  )
`)

console.log('All prospectus tables created successfully.')
await pool.end()
