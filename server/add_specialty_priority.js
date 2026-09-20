// One-off migration for existing databases: adds instructor_specialties.priority
// (1 = first priority, 2 = second priority). Existing rows default to 1 so
// nothing changes for anyone until they re-tag. A fresh database.sql import
// already has the column. Safe to re-run.
import pool from './config/db.js'

const [[dbRow]] = await pool.query('SELECT DATABASE() AS db')
const [[col]] = await pool.query(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'instructor_specialties' AND COLUMN_NAME = 'priority'`,
  [dbRow.db]
)
if (!col) {
  await pool.query('ALTER TABLE instructor_specialties ADD COLUMN priority TINYINT NOT NULL DEFAULT 1 AFTER subject_id')
  console.log('instructor_specialties.priority column added.')
} else {
  console.log('instructor_specialties.priority already exists, skipped.')
}
await pool.end()
