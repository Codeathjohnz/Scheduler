import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { generateSchedule, generateScheduleGA, generateScheduleORTools, detectConflicts, minToTime, timeToMin } from '../utils/scheduler.js'

const router = Router()

// ── GET /api/scheduling?year=&semester= ─────────────────────────────────────
// Returns all schedule rows + conflict list
router.get('/', authenticate, async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [rows] = await pool.query(`
      SELECT gs.*,
        r.building, r.room_number, r.room_type,
        COALESCE(CONCAT(r.building, ' ', r.room_number), 'Online Class') AS room_name,
        fle.course_code, fle.descriptive_title, fle.units,
        fle.lec_hours, fle.lab_hours, fle.program_yr_sec,
        u.name AS instructor_name, u.id AS instructor_id,
        chair.department AS dept
      FROM generated_schedules gs
      JOIN faculty_load_entries fle ON gs.faculty_entry_id = fle.id
      LEFT JOIN rooms r ON gs.room_id = r.id
      LEFT JOIN users u ON fle.assigned_instructor_id = u.id
      LEFT JOIN users chair ON fle.chair_id = chair.id
      WHERE gs.academic_year = ? AND gs.semester = ?
      ORDER BY gs.days, gs.start_time
    `, [year, semester])

    const conflicts = detectConflicts(rows)
    const conflictIds = new Set(conflicts.flatMap(c => c.ids))

    res.json({
      schedules: rows.map(r => ({ ...r, hasConflict: conflictIds.has(r.id) })),
      conflicts,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── POST /api/scheduling/generate ────────────────────────────────────────────
router.post('/generate', authenticate, authorize('admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1, clear_existing = true, engine = 'greedy' } = req.body
  try {
    // Only schedule entries from validated submissions
    const [validatedSubs] = await pool.query(
      `SELECT id, chair_id FROM submissions
       WHERE academic_year = ? AND semester = ? AND status = 'validated'`,
      [year, semester]
    )
    if (!validatedSubs.length) {
      return res.status(400).json({ message: 'No validated submissions found for this term. Admin must validate VPAA-endorsed submissions first.' })
    }
    const validatedChairIds = validatedSubs.map(s => s.chair_id)

    const [entries] = await pool.query(`
      SELECT fle.*, u.name AS instructor_name, u.is_placeholder AS is_placeholder, chair.department AS dept, p.program AS program
      FROM faculty_load_entries fle
      LEFT JOIN users u ON fle.assigned_instructor_id = u.id
      LEFT JOIN users chair ON fle.chair_id = chair.id
      LEFT JOIN prospectus_subjects ps ON fle.subject_id = ps.id
      LEFT JOIN prospectus p ON ps.prospectus_id = p.id
      WHERE fle.academic_year = ? AND fle.semester = ?
        AND fle.chair_id IN (?)
      ORDER BY fle.lab_hours DESC, fle.lec_hours DESC, fle.id
    `, [year, semester, validatedChairIds])

    if (!entries.length) {
      return res.status(400).json({ message: 'Validated submissions have no faculty load entries.' })
    }

    const [rooms] = await pool.query('SELECT * FROM rooms ORDER BY room_type, floor_level, id')
    if (!rooms.length) {
      return res.status(400).json({ message: 'No rooms found. Add rooms in Manage Rooms first.' })
    }

    // Build mobility map: instructor_id → mobility_level
    const [instructors] = await pool.query(
      'SELECT id, mobility_level FROM users WHERE role = "instructor"'
    )
    const mobilityMap = Object.fromEntries(
      instructors.map(i => [i.id, i.mobility_level ?? 3])
    )

    // Building priority map: building → { program → rank }
    const [priorityRows] = await pool.query(
      'SELECT building, program, priority FROM building_priorities ORDER BY building, priority'
    )
    const buildingPriorities = {}
    for (const row of priorityRows) {
      if (!buildingPriorities[row.building]) buildingPriorities[row.building] = {}
      buildingPriorities[row.building][row.program] = row.priority
    }

    // Run the scheduling engine — 'genetic' evolves complete candidate
    // schedules toward fewer conflicts/higher soft-constraint scores over
    // many generations; 'ortools' delegates to Google OR-Tools' CP-SAT
    // constraint solver (a separate Python microservice) for a real
    // constraint-programming guarantee of no hard-constraint violations;
    // 'greedy' (default) is the fast one-pass heuristic.
    const engineStart = Date.now()
    let result
    if (engine === 'genetic') {
      result = generateScheduleGA(entries, rooms, mobilityMap, buildingPriorities)
    } else if (engine === 'ortools') {
      result = await generateScheduleORTools(entries, rooms, mobilityMap, buildingPriorities)
    } else {
      result = generateSchedule(entries, rooms, mobilityMap, buildingPriorities)
    }
    const { scheduled, unscheduled } = result
    const engineRuntimeMs = Date.now() - engineStart

    // Persist results
    if (clear_existing) {
      await pool.query('DELETE FROM generated_schedules WHERE academic_year=? AND semester=?', [year, semester])
    }

    if (scheduled.length) {
      const rows = scheduled.map(s => [
        year, semester, s.entryId, s.sessionType,
        s.roomId, s.days.join(','), s.startTime, s.endTime, 0, 0,
      ])
      await pool.query(`
        INSERT INTO generated_schedules
          (academic_year, semester, faculty_entry_id, session_type,
           room_id, days, start_time, end_time, is_manual, is_published)
        VALUES ?
      `, [rows])
    }

    // Mark validated submissions as scheduled
    if (scheduled.length > 0) {
      await pool.query(
        `UPDATE submissions SET status = 'scheduled' WHERE academic_year = ? AND semester = ? AND status = 'validated'`,
        [year, semester]
      )
    }

    res.json({
      scheduled: scheduled.length,
      unscheduled: unscheduled.length,
      unscheduledList: unscheduled.map(u => ({ course: u.courseCode, reason: u.reason, type: u.sessionType })),
      engine,
      engineRuntimeMs,
      ...(engine === 'genetic' ? {
        generationsRun: result.generationsRun,
        finalFitness: result.finalFitness,
        hardConflicts: result.hardConflicts,
      } : {}),
      ...(engine === 'ortools' ? {
        solverStatus: result.solverStatus,
        objectiveValue: result.objectiveValue,
        solverWallTimeSeconds: result.solverWallTimeSeconds,
      } : {}),
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── PUT /api/scheduling/:id ───────────────────────────────────────────────────
// Manual override by admin
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  const { room_id, days, start_time, end_time } = req.body
  try {
    // Validate no conflict with existing schedules (excluding self)
    const [others] = await pool.query(`
      SELECT gs.*, r.building, r.room_number,
        COALESCE(CONCAT(r.building,' ',r.room_number), 'Online Class') AS room_name,
        fle.assigned_instructor_id AS instructor_id, u.name AS instructor_name,
        fle.program_yr_sec
      FROM generated_schedules gs
      JOIN faculty_load_entries fle ON gs.faculty_entry_id = fle.id
      LEFT JOIN rooms r ON gs.room_id = r.id
      LEFT JOIN users u ON fle.assigned_instructor_id = u.id
      WHERE gs.id != ? AND gs.academic_year = (SELECT academic_year FROM generated_schedules WHERE id=?)
        AND gs.semester = (SELECT semester FROM generated_schedules WHERE id=?)
    `, [req.params.id, req.params.id, req.params.id])

    // Check the entry this schedule belongs to
    const [[self]] = await pool.query(`
      SELECT gs.*, fle.assigned_instructor_id AS instructor_id, fle.program_yr_sec
      FROM generated_schedules gs
      JOIN faculty_load_entries fle ON gs.faculty_entry_id = fle.id
      WHERE gs.id = ?
    `, [req.params.id])

    // Keep lecture classes out of laboratories, and lab classes in them.
    if (room_id) {
      const [[room]] = await pool.query('SELECT building, room_number, room_type FROM rooms WHERE id = ?', [room_id])
      if (room && self.session_type === 'lecture' && room.room_type === 'Laboratory') {
        return res.status(400).json({ message: `${room.building} ${room.room_number} is a laboratory (LAB) — it's reserved for lab classes, not lectures.` })
      }
      if (room && self.session_type === 'lab' && room.room_type !== 'Laboratory') {
        return res.status(400).json({ message: `${room.building} ${room.room_number} is a ${room.room_type} room — lab classes need a laboratory (LAB).` })
      }
    }

    const newDays  = days.split(',')
    const newStart = timeToMin(start_time)
    const newEnd   = timeToMin(end_time)
    const newDur   = newEnd - newStart

    const conflicts = []
    for (const o of others) {
      const oDays  = o.days.split(',')
      const oStart = timeToMin(o.start_time)
      const oEnd   = timeToMin(o.end_time)
      const shared = newDays.some(d => oDays.includes(d))
      if (!shared) continue
      const overlaps = newStart < oEnd && newEnd > oStart
      if (!overlaps) continue
      if (o.room_id === Number(room_id)) conflicts.push(`Room ${o.room_name} is already in use`)
      if (o.instructor_id && o.instructor_id === self.instructor_id) conflicts.push(`Instructor already has a class at this time`)
      if (o.program_yr_sec && o.program_yr_sec === self.program_yr_sec) conflicts.push(`Section ${o.program_yr_sec} already has a class at this time`)
    }

    if (conflicts.length) {
      return res.status(409).json({ message: 'Scheduling conflict detected', conflicts })
    }

    await pool.query(
      'UPDATE generated_schedules SET room_id=?, days=?, start_time=?, end_time=?, is_manual=1 WHERE id=?',
      [room_id || null, days, start_time, end_time, req.params.id]
    )
    res.json({ message: 'Schedule updated.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── POST /api/scheduling/publish ──────────────────────────────────────────────
router.post('/publish', authenticate, authorize('admin'), async (req, res) => {
  const { year, semester } = req.body
  try {
    await pool.query(
      'UPDATE generated_schedules SET is_published=1 WHERE academic_year=? AND semester=?',
      [year, semester]
    )
    res.json({ message: 'Schedule published. Instructors and students can now view it.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── DELETE /api/scheduling/clear ──────────────────────────────────────────────
router.delete('/clear', authenticate, authorize('admin'), async (req, res) => {
  const { year, semester } = req.query
  try {
    await pool.query('DELETE FROM generated_schedules WHERE academic_year=? AND semester=?', [year, semester])
    res.json({ message: 'Schedules cleared.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── GET /api/scheduling/dept — chair sees their department's published schedule ─
router.get('/dept', authenticate, authorize('chair'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [rows] = await pool.query(`
      SELECT gs.*,
        r.building, r.room_number, r.room_type,
        COALESCE(CONCAT(r.building, ' ', r.room_number), 'Online Class') AS room_name,
        fle.course_code, fle.descriptive_title, fle.units,
        fle.lec_hours, fle.lab_hours, fle.program_yr_sec,
        u.name AS instructor_name, u.id AS instructor_id
      FROM generated_schedules gs
      JOIN faculty_load_entries fle ON gs.faculty_entry_id = fle.id
      LEFT JOIN rooms r ON gs.room_id = r.id
      LEFT JOIN users u ON fle.assigned_instructor_id = u.id
      WHERE fle.chair_id = ?
        AND gs.academic_year = ? AND gs.semester = ?
        AND gs.is_published = 1
      ORDER BY gs.days, gs.start_time
    `, [req.user.id, year, semester])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/scheduling/my — instructor's own published schedule ─────────────
router.get('/my', authenticate, async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [rows] = await pool.query(`
      SELECT gs.*,
        COALESCE(CONCAT(r.building, ' ', r.room_number), 'Online Class') AS room_name,
        r.building, r.room_number, r.room_type,
        fle.course_code, fle.descriptive_title, fle.units,
        fle.lec_hours, fle.lab_hours, fle.program_yr_sec
      FROM generated_schedules gs
      JOIN faculty_load_entries fle ON gs.faculty_entry_id = fle.id
      LEFT JOIN rooms r ON gs.room_id = r.id
      WHERE fle.assigned_instructor_id = ?
        AND gs.academic_year = ? AND gs.semester = ?
        AND gs.is_published = 1
      ORDER BY gs.days, gs.start_time
    `, [req.user.id, year, semester])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/scheduling/my-section — student's own section's published schedule ─
router.get('/my-section', authenticate, authorize('student'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  if (!req.user.section) return res.json([])
  try {
    const [rows] = await pool.query(`
      SELECT gs.*,
        COALESCE(CONCAT(r.building, ' ', r.room_number), 'Online Class') AS room_name,
        r.building, r.room_number, r.room_type,
        fle.course_code, fle.descriptive_title, fle.units,
        fle.lec_hours, fle.lab_hours, fle.program_yr_sec,
        u.name AS instructor_name
      FROM generated_schedules gs
      JOIN faculty_load_entries fle ON gs.faculty_entry_id = fle.id
      LEFT JOIN rooms r ON gs.room_id = r.id
      LEFT JOIN users u ON fle.assigned_instructor_id = u.id
      WHERE fle.program_yr_sec = ?
        AND gs.academic_year = ? AND gs.semester = ?
        AND gs.is_published = 1
      ORDER BY gs.days, gs.start_time
    `, [req.user.section, year, semester])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/scheduling/rooms — available rooms for manual assignment ─────────
router.get('/rooms', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM rooms ORDER BY room_type, building, room_number')
    res.json(rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

export default router
