import pool from './config/db.js'

await pool.query(`
  CREATE TABLE IF NOT EXISTS load_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    instructor_id INT NOT NULL,
    academic_year VARCHAR(20) NOT NULL,
    semester TINYINT NOT NULL DEFAULT 1,
    load_type ENUM('administrative','research','extension','project','consultation','lesson_prep') NOT NULL,
    description VARCHAR(200) NOT NULL,
    units FLOAT NOT NULL,
    hours FLOAT NULL,
    status ENUM('pending','approved','rejected') DEFAULT 'pending',
    reviewed_by INT,
    reviewed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
  )
`)

console.log('load_requests table created.')
await pool.end()
