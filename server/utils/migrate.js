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

// Finds the FK constraint on `table.column` that references `users(id)` —
// looked up by table+column rather than a hardcoded constraint name, since
// the live database's constraints (created across many ad-hoc add_*.js
// scripts over time) don't all share database.sql's naming.
async function fkOnUsers(pool, table, column) {
  const [[row]] = await pool.query(
    `SELECT k.CONSTRAINT_NAME, r.DELETE_RULE
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
     JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.COLUMN_NAME = ?
       AND k.REFERENCED_TABLE_NAME = 'users'
     LIMIT 1`,
    [table, column]
  )
  return row || null
}

// Re-points an existing users(id) FK to a new ON DELETE rule, idempotently.
async function setDeleteRule(pool, table, column, rule) {
  const fk = await fkOnUsers(pool, table, column)
  if (!fk || fk.DELETE_RULE === rule) return false
  await pool.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``)
  await pool.query(
    `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${fk.CONSTRAINT_NAME}\`
     FOREIGN KEY (\`${column}\`) REFERENCES \`users\` (\`id\`) ON DELETE ${rule}`
  )
  return true
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
  {
    name: 'users.is_placeholder / placeholder_owner (stand-in instructors)',
    async run(pool) {
      if (await columnInfo(pool, 'users', 'is_placeholder')) return false
      await pool.query('ALTER TABLE users ADD COLUMN is_placeholder TINYINT(1) NOT NULL DEFAULT 0 AFTER cross_dept_open')
      await pool.query('ALTER TABLE users ADD COLUMN placeholder_owner INT NULL DEFAULT NULL AFTER is_placeholder')
      return true
    },
  },
  {
    name: 'notifications table (dashboard notification box)',
    async run(pool) {
      const [[t]] = await pool.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'"
      )
      if (t) return false
      await pool.query(`
        CREATE TABLE notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          type VARCHAR(40) NOT NULL,
          title VARCHAR(160) NOT NULL,
          body TEXT NULL,
          link VARCHAR(200) NULL,
          ref_id INT NULL,
          flag VARCHAR(20) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          read_at TIMESTAMP NULL DEFAULT NULL,
          KEY idx_user (user_id, read_at, created_at),
          CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
      return true
    },
  },
  {
    name: 'load_changes table (log of placeholder -> real instructor swaps)',
    async run(pool) {
      const [[t]] = await pool.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'load_changes'"
      )
      if (t) return false
      await pool.query(`
        CREATE TABLE load_changes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          chair_id INT NOT NULL,
          placeholder_id INT NOT NULL,
          instructor_id INT NOT NULL,
          academic_year VARCHAR(20) NOT NULL,
          semester TINYINT NOT NULL,
          entry_ids TEXT NOT NULL,
          reason VARCHAR(255) NULL,
          is_exception TINYINT(1) NOT NULL DEFAULT 0,
          status ENUM('pending','confirmed','declined') NOT NULL DEFAULT 'pending',
          rescheduled INT NOT NULL DEFAULT 0,
          unresolved INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          confirmed_at TIMESTAMP NULL DEFAULT NULL,
          KEY idx_chair (chair_id),
          KEY idx_instructor (instructor_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
      return true
    },
  },
  {
    name: 'dept_access_requests table (chair asks another department dean for instructor access)',
    async run(pool) {
      const [[t]] = await pool.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dept_access_requests'"
      )
      if (t) return false
      await pool.query(`
        CREATE TABLE dept_access_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          requester_id INT NOT NULL,
          target_department VARCHAR(150) NOT NULL,
          academic_year VARCHAR(20) NOT NULL,
          semester TINYINT NOT NULL,
          note VARCHAR(255) NULL,
          status ENUM('pending','approved','declined','cancelled') NOT NULL DEFAULT 'pending',
          decided_by INT NULL,
          decline_reason VARCHAR(255) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          decided_at TIMESTAMP NULL DEFAULT NULL,
          KEY idx_requester (requester_id, status),
          KEY idx_target (target_department, status),
          CONSTRAINT fk_dar_requester FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
      return true
    },
  },
  // Deleting a user (Manage Users) was failing for anyone with rows in a
  // handful of older tables whose users(id) foreign key had no ON DELETE
  // rule at all (MySQL/MariaDB default: RESTRICT) — reported live as
  // "some instructors won't delete". These four are rows that belong
  // entirely to that one person (their own accessibility request, manual
  // submission entry/confirmation, legacy per-instructor schedule row, or
  // section-count preset) and are correctly removed along with them.
  {
    name: 'accessibility_requests.instructor_id ON DELETE CASCADE',
    async run(pool) { return setDeleteRule(pool, 'accessibility_requests', 'instructor_id', 'CASCADE') },
  },
  {
    name: 'submission_confirmations.instructor_id ON DELETE CASCADE',
    async run(pool) { return setDeleteRule(pool, 'submission_confirmations', 'instructor_id', 'CASCADE') },
  },
  {
    name: 'submission_entries.instructor_id ON DELETE CASCADE',
    async run(pool) { return setDeleteRule(pool, 'submission_entries', 'instructor_id', 'CASCADE') },
  },
  {
    name: 'schedules.instructor_id ON DELETE CASCADE (legacy per-instructor schedule row)',
    async run(pool) { return setDeleteRule(pool, 'schedules', 'instructor_id', 'CASCADE') },
  },
  {
    name: 'section_counts.chair_id ON DELETE CASCADE (regenerable per-chair preset)',
    async run(pool) { return setDeleteRule(pool, 'section_counts', 'chair_id', 'CASCADE') },
  },
  // These two are pure "who did this" attribution on someone ELSE's record
  // (an instructor's own admin-load entry; who reviewed a load request) —
  // safe to blank out rather than block the delete. Both columns need to be
  // made nullable first so SET NULL has somewhere to put NULL.
  {
    name: 'faculty_admin_loads.chair_id nullable + ON DELETE SET NULL',
    async run(pool) {
      let changed = false
      const [[nullableRow]] = await pool.query(
        `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'faculty_admin_loads' AND COLUMN_NAME = 'chair_id'`
      )
      if (nullableRow?.IS_NULLABLE === 'NO') {
        await pool.query('ALTER TABLE faculty_admin_loads MODIFY COLUMN chair_id INT NULL')
        changed = true
      }
      const ruleChanged = await setDeleteRule(pool, 'faculty_admin_loads', 'chair_id', 'SET NULL')
      return changed || ruleChanged
    },
  },
  {
    name: 'load_requests.reviewed_by ON DELETE SET NULL',
    async run(pool) { return setDeleteRule(pool, 'load_requests', 'reviewed_by', 'SET NULL') },
  },
  // users.department is free text (Manage Users has a datalist of
  // suggestions, nothing enforces picking one), and every department-scoped
  // feature matches it by exact string equality against the Program Chair's
  // own account — a stray leading/trailing/doubled space is invisible in the
  // UI but means "CEIT" and "CEIT " never match. Reported live as some
  // instructors seeing "No prospectus uploaded" for a department that in
  // fact has one. New accounts are cleaned at creation (see cleanDept in
  // routes/users.js) — this is the one-time cleanup for existing rows.
  {
    name: 'users.department — clean up stray whitespace on existing rows',
    async run(pool) {
      // Compared in JS, not SQL: MySQL/MariaDB's `=`/`<>` on a non-binary
      // VARCHAR ignores TRAILING-space-only differences (ANSI PAD SPACE
      // behavior) and `department <> TRIM(department)` only ever reveals
      // leading/trailing whitespace anyway — neither catches an internal
      // run like "CE  IT", which is exactly as silent a mismatch as a
      // leading space and was missed entirely by an earlier version of
      // this step. An exact JS string comparison catches all three forms.
      const [rows] = await pool.query('SELECT id, department FROM users WHERE department IS NOT NULL')
      let changed = 0
      for (const r of rows) {
        const cleaned = r.department.trim().replace(/\s+/g, ' ') || null
        if (cleaned !== r.department) {
          await pool.query('UPDATE users SET department = ? WHERE id = ?', [cleaned, r.id])
          changed++
        }
      }
      return changed > 0
    },
  },
  // Transaction history: one row per department each time a term's schedule
  // is published, so the registrar can see which departments are finished.
  {
    name: 'schedule_history table (published schedules, per department)',
    async run(pool) {
      const [[t]] = await pool.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedule_history'"
      )
      if (t) return false
      await pool.query(`
        CREATE TABLE schedule_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          academic_year VARCHAR(20) NOT NULL,
          semester TINYINT NOT NULL,
          department VARCHAR(100) NOT NULL,
          subjects INT NOT NULL DEFAULT 0,
          sessions INT NOT NULL DEFAULT 0,
          published_by INT NULL,
          published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_term (academic_year, semester)
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
