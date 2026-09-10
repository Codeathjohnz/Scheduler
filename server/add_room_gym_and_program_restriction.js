// One-off migration for existing databases created before the Gym room
// type and per-room program restriction were added — a fresh database.sql
// import already has both. Safe to re-run (checks INFORMATION_SCHEMA first).
import pool from './config/db.js'

const [[dbRow]] = await pool.query('SELECT DATABASE() AS db')
const dbName = dbRow.db

const [[typeCol]] = await pool.query(
  `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'rooms' AND COLUMN_NAME = 'room_type'`,
  [dbName]
)
if (typeCol && !typeCol.COLUMN_TYPE.includes("'Gym'")) {
  await pool.query(`ALTER TABLE rooms MODIFY COLUMN room_type ENUM('Lecture','Laboratory','Special','Gym') NOT NULL DEFAULT 'Lecture'`)
  console.log("rooms.room_type: added 'Gym'.")
} else {
  console.log("rooms.room_type already has 'Gym', skipped.")
}

const [[restrictionCol]] = await pool.query(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'rooms' AND COLUMN_NAME = 'program_restriction'`,
  [dbName]
)
if (!restrictionCol) {
  await pool.query(
    `ALTER TABLE rooms ADD COLUMN program_restriction VARCHAR(255) NULL DEFAULT NULL AFTER is_accessible
     COMMENT 'Comma-separated list of programs/departments allowed to use this room, e.g. "CCIS,BSIT,BSIS". NULL/empty = open to everyone.'`
  )
  console.log('rooms.program_restriction column added.')
} else {
  console.log('rooms.program_restriction already exists, skipped.')
}

const [[gymRoom]] = await pool.query(`SELECT id FROM rooms WHERE room_type = 'Gym' LIMIT 1`)
if (!gymRoom) {
  await pool.query(
    `INSERT INTO rooms (building, room_number, capacity, room_type, floor_level, is_accessible) VALUES (?,?,?,?,?,?)`,
    ['Gym', 'University Gym', 300, 'Gym', 1, 1]
  )
  console.log('Seeded a default "University Gym" room — rename/adjust it in Manage Rooms as needed.')
} else {
  console.log('A Gym room already exists, skipped seeding one.')
}

await pool.end()
