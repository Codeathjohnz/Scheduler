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
  {
    name: 'users.cross_dept_open (willing to teach for other departments)',
    async run(pool) {
      if (await columnInfo(pool, 'users', 'cross_dept_open')) return false
      await pool.query('ALTER TABLE users ADD COLUMN cross_dept_open TINYINT(1) NOT NULL DEFAULT 0 AFTER programs')
      return true
    },
  },
  {
    name: 'cross_dept_requests table (teaching for another department)',
    async run(pool) {
      const [[t]] = await pool.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cross_dept_requests'"
      )
      if (t) return false
      await pool.query(`
        CREATE TABLE cross_dept_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          entry_id INT NOT NULL,
          instructor_id INT NOT NULL,
          requested_by INT NOT NULL,
          status ENUM('pending_instructor','pending_home','approved','declined','cancelled') NOT NULL DEFAULT 'pending_instructor',
          note VARCHAR(255) NULL,
          decline_reason VARCHAR(255) NULL,
          declined_stage VARCHAR(20) NULL,
          home_approver_id INT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          instructor_action_at TIMESTAMP NULL DEFAULT NULL,
          home_action_at TIMESTAMP NULL DEFAULT NULL,
          KEY idx_entry (entry_id),
          KEY idx_instructor (instructor_id, status),
          KEY idx_requested_by (requested_by),
          CONSTRAINT fk_cdr_entry FOREIGN KEY (entry_id) REFERENCES faculty_load_entries (id) ON DELETE CASCADE,
          CONSTRAINT fk_cdr_instructor FOREIGN KEY (instructor_id) REFERENCES users (id) ON DELETE CASCADE,
          CONSTRAINT fk_cdr_requested_by FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
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
