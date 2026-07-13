import pool from './config/db.js'

await pool.query(`
  ALTER TABLE users MODIFY role
  ENUM('admin','chair','vpaa','instructor','student','dean','quality_assurance') NOT NULL
`)
console.log('users.role enum extended with dean, quality_assurance.')

await pool.query(`
  ALTER TABLE submissions MODIFY status
  ENUM('pending_instructor','pending_dean','pending_qa','pending_vpaa','pending_admin','validated','returned','scheduled')
  DEFAULT 'pending_instructor'
`)
console.log('submissions.status enum extended with pending_instructor, pending_dean, pending_qa.')

const [cols] = await pool.query(`SHOW COLUMNS FROM submissions LIKE 'dean_action_at'`)
if (cols.length === 0) {
  await pool.query('ALTER TABLE submissions ADD COLUMN dean_action_at TIMESTAMP NULL AFTER vpaa_action_at')
  await pool.query('ALTER TABLE submissions ADD COLUMN qa_action_at TIMESTAMP NULL AFTER dean_action_at')
  console.log('Added dean_action_at, qa_action_at columns to submissions.')
} else {
  console.log('dean_action_at already exists — skipping.')
}

await pool.query(`
  CREATE TABLE IF NOT EXISTS submission_confirmations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    submission_id INT NOT NULL,
    instructor_id INT NOT NULL,
    confirmed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_submission_instructor (submission_id, instructor_id),
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES users(id)
  )
`)
console.log('submission_confirmations table ready.')

await pool.end()
