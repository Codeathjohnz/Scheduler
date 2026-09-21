/**
 * Dashboard notifications.
 *
 * One row per recipient in `notifications`; every dashboard shows the box
 * (client: NotificationBox). Never throws — a failed notification must not
 * undo the change that caused it.
 */
import pool from '../config/db.js'

export async function notify(userIds, { type, title, body = null, link = null, refId = null, flag = null }) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean))]
    if (!ids.length) return
    await pool.query(
      'INSERT INTO notifications (user_id, type, title, body, link, ref_id, flag) VALUES ?',
      [ids.map(id => [id, type, String(title).slice(0, 160), body, link, refId, flag])]
    )
  } catch (err) {
    console.error('[notify] failed:', err.message)
  }
}

// Registrar / admin accounts — they publish schedules and print the official load sheets.
export async function adminIds() {
  const [rows] = await pool.query("SELECT id FROM users WHERE role = 'admin'")
  return rows.map(r => r.id)
}

export async function deanIds(department) {
  if (!department) return []
  const [rows] = await pool.query("SELECT id FROM users WHERE role = 'dean' AND department = ?", [department])
  return rows.map(r => r.id)
}

// Chairs and deans of a department — the people who sign off for its faculty.
export async function departmentLeadIds(department) {
  if (!department) return []
  const [rows] = await pool.query("SELECT id FROM users WHERE role IN ('chair', 'dean') AND department = ?", [department])
  return rows.map(r => r.id)
}
