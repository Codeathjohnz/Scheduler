import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { detectConflicts } from '../utils/scheduler.js'

const router = Router()

// GET /api/admin/stats — dashboard summary
router.get('/stats', authenticate, authorize('admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [[counts]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM rooms)                                                        AS total_rooms,
        (SELECT COUNT(*) FROM users WHERE role = 'instructor')                             AS total_instructors,
        (SELECT COUNT(*) FROM users WHERE role = 'chair')                                  AS total_chairs,
        (SELECT COUNT(*) FROM submissions WHERE status = 'endorsed')                       AS pending_validation,
        (SELECT COUNT(*) FROM submissions)                                                  AS total_submissions,
        (SELECT COUNT(*) FROM generated_schedules WHERE academic_year=? AND semester=?)    AS total_sessions,
        (SELECT COUNT(*) FROM generated_schedules WHERE academic_year=? AND semester=? AND is_published=1) AS published_sessions,
        (SELECT COUNT(*) FROM accessibility_requests WHERE status = 'pending')             AS pending_accessibility,
        (SELECT COUNT(*) FROM faculty_load_entries WHERE academic_year=? AND semester=?)   AS faculty_entries
    `, [year, semester, year, semester, year, semester])

    // Real-time room availability (is any approved schedule running right now?)
    const [roomStatus] = await pool.query(`
      SELECT r.id, r.building, r.room_number, r.room_type,
        CASE WHEN EXISTS (
          SELECT 1 FROM generated_schedules gs
          JOIN faculty_load_entries fle ON gs.faculty_entry_id = fle.id
          WHERE gs.room_id = r.id
            AND gs.is_published = 1
            AND FIND_IN_SET(DAYNAME(NOW()), REPLACE(gs.days, ', ', ','))
            AND TIME(NOW()) BETWEEN gs.start_time AND gs.end_time
        ) THEN 'occupied' ELSE 'available' END AS status
      FROM rooms r
      ORDER BY r.building, r.room_number
    `)
    const availableRooms = roomStatus.filter(r => r.status === 'available').length
    const occupiedRooms  = roomStatus.filter(r => r.status === 'occupied').length

    // Conflicts in current schedule
    const [scheduleRows] = await pool.query(`
      SELECT gs.*,
        COALESCE(CONCAT(r.building,' ',r.room_number), 'Online Class') AS room_name,
        r.room_type,
        fle.course_code, fle.program_yr_sec,
        u.name AS instructor_name, u.id AS instructor_id
      FROM generated_schedules gs
      JOIN faculty_load_entries fle ON gs.faculty_entry_id = fle.id
      LEFT JOIN rooms r ON gs.room_id = r.id
      LEFT JOIN users u ON fle.assigned_instructor_id = u.id
      WHERE gs.academic_year = ? AND gs.semester = ?
    `, [year, semester])
    const conflicts = detectConflicts(scheduleRows)

    res.json({
      ...counts,
      available_rooms: availableRooms,
      occupied_rooms:  occupiedRooms,
      conflicts:       conflicts.length,
      year,
      semester,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/admin/activity — recent activity feed from all tables
router.get('/activity', authenticate, authorize('admin'), async (req, res) => {
  try {
    const activity = []

    // 1. Recent submissions (each one is a distinct event)
    const [subs] = await pool.query(`
      SELECT s.id, s.status, s.created_at AS ts, u.name AS chair_name
      FROM submissions s
      JOIN users u ON s.chair_id = u.id
      ORDER BY s.created_at DESC LIMIT 5
    `)
    for (const s of subs) {
      const statusLabel = {
        pending_vpaa: 'submitted — awaiting VPAA endorsement',
        endorsed:     'endorsed by VPAA — pending admin validation',
        validated:    'validated by admin',
        rejected:     'rejected',
      }[s.status] || s.status
      activity.push({ type: 'submission', msg: `Submission by ${s.chair_name} ${statusLabel}`, ts: s.ts })
    }

    // 2. Recent accessibility requests
    const [accRows] = await pool.query(`
      SELECT ar.id, ar.reason, ar.status, ar.created_at AS ts, u.name AS instructor_name
      FROM accessibility_requests ar
      JOIN users u ON ar.instructor_id = u.id
      ORDER BY ar.created_at DESC LIMIT 5
    `)
    for (const a of accRows) {
      activity.push({ type: 'accessibility', msg: `Accessibility request from ${a.instructor_name}: "${a.reason}"`, ts: a.ts })
    }

    // 3. Schedule generate/publish events — grouped by minute to collapse bulk batches
    const [schedRows] = await pool.query(`
      SELECT
        DATE_FORMAT(gs.created_at, '%Y-%m-%d %H:%i') AS batch_minute,
        MAX(gs.created_at) AS ts,
        COUNT(*) AS session_count,
        MAX(gs.is_published) AS is_published,
        GROUP_CONCAT(DISTINCT fle.academic_year ORDER BY fle.academic_year) AS years,
        GROUP_CONCAT(DISTINCT gs.semester ORDER BY gs.semester) AS semesters
      FROM generated_schedules gs
      JOIN faculty_load_entries fle ON gs.faculty_entry_id = fle.id
      GROUP BY batch_minute
      ORDER BY ts DESC
      LIMIT 5
    `)
    for (const s of schedRows) {
      const action = Number(s.is_published) === 1 ? 'published' : 'generated'
      activity.push({
        type: 'schedule',
        msg: `Schedule ${action} — ${s.session_count} sessions for A.Y. ${s.years} Sem ${s.semesters}`,
        ts: s.ts,
      })
    }

    // 4. Recent new users
    const [userRows] = await pool.query(`
      SELECT name, role, created_at AS ts FROM users
      ORDER BY created_at DESC LIMIT 4
    `)
    for (const u of userRows) {
      const roleLabel = { admin: 'Admin', chair: 'Program Chair', vpaa: 'VPAA', instructor: 'Instructor', student: 'Student' }[u.role] || u.role
      activity.push({ type: 'user', msg: `New user added: ${u.name} (${roleLabel})`, ts: u.ts })
    }

    // Sort all by timestamp desc, take top 10
    activity.sort((a, b) => new Date(b.ts) - new Date(a.ts))
    res.json(activity.slice(0, 10))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
