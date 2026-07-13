import pool from './config/db.js'

await pool.query(`
  CREATE TABLE IF NOT EXISTS generated_schedules (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    academic_year    VARCHAR(20) NOT NULL,
    semester         TINYINT NOT NULL DEFAULT 1,
    faculty_entry_id INT NOT NULL,
    session_type     ENUM('lecture','lab') DEFAULT 'lecture',
    room_id          INT,
    days             VARCHAR(100) NOT NULL,
    start_time       TIME NOT NULL,
    end_time         TIME NOT NULL,
    is_manual        TINYINT(1) DEFAULT 0,
    is_published     TINYINT(1) DEFAULT 0,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faculty_entry_id) REFERENCES faculty_load_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id)          REFERENCES rooms(id) ON DELETE SET NULL
  )
`)

console.log('generated_schedules table created.')
await pool.end()
