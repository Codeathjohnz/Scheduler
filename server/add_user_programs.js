// One-off migration for existing databases: adds users.programs — a
// comma-separated list of the programs an instructor teaches for within their
// department (e.g. "BSIT", "BSIS", or "BSIT,BSIS"). NULL/empty = not
// restricted to any program (eligible for every program in the department),
// so nothing changes for existing accounts. A fresh database.sql import
// already has the column. Safe to re-run.
import pool from './config/db.js'

const [[dbRow]] = await pool.query('SELECT DATABASE() AS db')
const [[col]] = await pool.query(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'programs'`,
  [dbRow.db]
)
if (!col) {
  await pool.query('ALTER TABLE users ADD COLUMN programs VARCHAR(255) NULL DEFAULT NULL AFTER section')
  console.log('users.programs column added.')
} else {
  console.log('users.programs already exists, skipped.')
}
await pool.end()
