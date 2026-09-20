/**
 * Startup schema migrations.
 *
 * Runs every time the server boots (see server.js) and only applies what's
 * missing, so a redeploy to an existing database (e.g. the live server via
 * Dokploy) upgrades it automatically — no one has to remember to run the
 * one-off add_*.js scripts by hand. Every step checks INFORMATION_SCHEMA
 * first, so running it again on an up-to-date database changes nothing.
 * (INFORMATION_SCHEMA checks rather than `ADD COLUMN IF NOT EXISTS` so it
 * works on both MySQL and MariaDB.)
 *
 * Add new steps to the bottom of `steps` — keep them idempotent.
 */

async function columnInfo(pool, table, column) {
  const [[row]] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  )
  return row || null
}

const steps = [
  {
    name: "rooms.room_type includes 'Gym' (+ seed one gym room)",
    async run(pool) {
      const col = await columnInfo(pool, 'rooms', 'room_type')
      if (!col || col.COLUMN_TYPE.includes("'Gym'")) return false
      await pool.query(`ALTER TABLE rooms MODIFY COLUMN room_type ENUM('Lecture','Laboratory','Special','Gym') NOT NULL DEFAULT 'Lecture'`)
      // Seeded only at the moment the Gym type is introduced, so a gym the
      // admin later renames or deletes is never re-created on restart.
      const [[gym]] = await pool.query(`SELECT id FROM rooms WHERE room_type = 'Gym' LIMIT 1`)
      if (!gym) {
        await pool.query(
          `INSERT INTO rooms (building, room_number, capacity, room_type, floor_level, is_accessible) VALUES (?,?,?,?,?,?)`,
          ['Gym', 'University Gym', 300, 'Gym', 1, 1]
        )
      }
      return true
    },
  },
  {
    name: 'rooms.program_restriction',
    async run(pool) {
      if (await columnInfo(pool, 'rooms', 'program_restriction')) return false
      await pool.query('ALTER TABLE rooms ADD COLUMN program_restriction VARCHAR(255) NULL DEFAULT NULL AFTER is_accessible')
      return true
    },
  },
  {
    name: 'instructor_specialties.priority (1st/2nd priority)',
    async run(pool) {
      if (await columnInfo(pool, 'instructor_specialties', 'priority')) return false
      // Existing specialties become 1st priority, so nothing changes until people re-tag.
      await pool.query('ALTER TABLE instructor_specialties ADD COLUMN priority TINYINT NOT NULL DEFAULT 1 AFTER subject_id')
      return true
    },
  },
  {
    name: 'users.programs (programs an instructor teaches for)',
    async run(pool) {
      if (await columnInfo(pool, 'users', 'programs')) return false
      await pool.query('ALTER TABLE users ADD COLUMN programs VARCHAR(255) NULL DEFAULT NULL AFTER section')
      return true
    },
  },
]

export async function runMigrations(pool) {
  for (const step of steps) {
    try {
      const applied = await step.run(pool)
      if (applied) console.log(`[migrate] applied: ${step.name}`)
    } catch (err) {
      // Don't take the whole server down over one step — but say so loudly,
      // since the feature that depends on it will error until it's fixed.
      console.error(`[migrate] FAILED: ${step.name} — ${err.message}`)
    }
  }
}
