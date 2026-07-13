import pool from './config/db.js'

await pool.query(`
  CREATE TABLE IF NOT EXISTS faculty_load_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academic_year VARCHAR(20) NOT NULL DEFAULT '2026-2027',
    semester TINYINT NOT NULL DEFAULT 1,
    course_code VARCHAR(40) NOT NULL,
    descriptive_title VARCHAR(250) NOT NULL,
    program_yr_sec VARCHAR(50) NOT NULL,
    year_level TINYINT,
    units FLOAT DEFAULT 3,
    lec_hours FLOAT DEFAULT 3,
    lab_hours FLOAT DEFAULT 0,
    assigned_instructor_id INT,
    room VARCHAR(50),
    subject_id INT,
    sort_order INT DEFAULT 0,
    chair_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_instructor_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (chair_id) REFERENCES users(id),
    FOREIGN KEY (subject_id) REFERENCES prospectus_subjects(id) ON DELETE SET NULL
  )
`)

await pool.query(`
  CREATE TABLE IF NOT EXISTS faculty_admin_loads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    instructor_id INT NOT NULL,
    academic_year VARCHAR(20) NOT NULL,
    semester TINYINT NOT NULL DEFAULT 1,
    description VARCHAR(200),
    units FLOAT DEFAULT 0,
    hours FLOAT NULL,
    lec_hours FLOAT DEFAULT 0,
    lab_hours FLOAT DEFAULT 0,
    load_type ENUM('administrative','research','extension','project','consultation','lesson_prep') NOT NULL DEFAULT 'administrative',
    chair_id INT NOT NULL,
    FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (chair_id) REFERENCES users(id)
  )
`)

console.log('Faculty load tables created.')
await pool.end()
