/**
 * Re-slot the sessions of specific faculty-load entries WITHOUT disturbing the
 * rest of an already-approved schedule.
 *
 * When a placeholder ("Instructor E") is replaced by a real instructor, the
 * subject's existing day/time/room can stay exactly as approved — unless the
 * new instructor already teaches something at that same time. Only then are
 * that subject's sessions moved, and only that subject's: every other session
 * (real instructors' included) is treated as fixed and scheduled around.
 * That's also the "real instructors have priority" rule in practice — a real
 * instructor's existing classes never move to make room for the newcomer's.
 *
 * A subject that can't be re-slotted anywhere is left where it was and
 * reported as `unresolved`, so a person can sort it out rather than the system
 * silently dropping a class.
 */
import pool from '../config/db.js'
import { generateSchedule, timeToMin } from './scheduler.js'

const DAY_BITS = { Monday: 1, Tuesday: 2, Wednesday: 4, Thursday: 8, Friday: 16, Saturday: 32 }
const maskOf = (days) => days.reduce((acc, d) => acc | (DAY_BITS[d] || 0), 0)
const overlap = (aStart, aDur, bStart, bDur) => aStart < bStart + bDur && aStart + aDur > bStart

function toPlacement(row) {
  const days = String(row.days).split(',').map(d => d.trim()).filter(Boolean)
  const startMin = timeToMin(String(row.start_time).slice(0, 5))
  const endMin = timeToMin(String(row.end_time).slice(0, 5))
  return {
    row, entryId: row.faculty_entry_id, instructorId: row.instructor_id || null, programYrSec: row.program_yr_sec || '',
    roomId: row.room_id, days, daysMask: maskOf(days), startMin, durationMin: endMin - startMin,
    sessionType: row.session_type,
  }
}

// Human-readable "Mon/Wed 09:00–10:00 · CEIT 207"
function describe(row, roomNames) {
  const d = String(row.days).split(',').map(x => x.trim().slice(0, 3)).join('/')
  return `${d} ${String(row.start_time).slice(0, 5)}–${String(row.end_time).slice(0, 5)} · ${row.room_id ? (roomNames.get(row.room_id) || 'a room') : 'Online'}`
}

/**
 * @param {{ academicYear: string, semester: number, movedEntryIds: number[], instructorId: number }} args
 *   Call AFTER the entries have been reassigned to `instructorId`.
 * @returns {{ checked: number, rescheduled: object[], unresolved: object[] }}
 */
export async function rescheduleConflicts({ academicYear, semester, movedEntryIds, instructorId }) {
  const [rows] = await pool.query(
    `SELECT gs.*, fle.program_yr_sec, fle.assigned_instructor_id AS instructor_id, fle.course_code
     FROM generated_schedules gs
     JOIN faculty_load_entries fle ON fle.id = gs.faculty_entry_id
     WHERE gs.academic_year = ? AND gs.semester = ?`,
    [academicYear, semester]
  )
  if (!rows.length) return { checked: 0, rescheduled: [], unresolved: [] }

  const moved = new Set(movedEntryIds)
  const placements = rows.map(toPlacement)
  const movedRows = placements.filter(p => moved.has(p.entryId))
  const theirOther = placements.filter(p => p.instructorId === instructorId && !moved.has(p.entryId))

  // Which moved subjects now clash with something the new instructor already teaches?
  const conflictingEntries = new Set()
  for (const m of movedRows) {
    if (theirOther.some(o => (o.daysMask & m.daysMask) && overlap(o.startMin, o.durationMin, m.startMin, m.durationMin))) {
      conflictingEntries.add(m.entryId)
    }
  }
  if (!conflictingEntries.size) return { checked: movedRows.length, rescheduled: [], unresolved: [] }

  const ids = [...conflictingEntries]
  const [entries] = await pool.query(
    `SELECT fle.*, u.name AS instructor_name, u.is_placeholder AS is_placeholder, chair.department AS dept, p.program AS program
     FROM faculty_load_entries fle
     LEFT JOIN users u ON fle.assigned_instructor_id = u.id
     LEFT JOIN users chair ON fle.chair_id = chair.id
     LEFT JOIN prospectus_subjects ps ON fle.subject_id = ps.id
     LEFT JOIN prospectus p ON ps.prospectus_id = p.id
     WHERE fle.id IN (?)`, [ids]
  )
  const [rooms] = await pool.query('SELECT * FROM rooms ORDER BY room_type, floor_level, id')
  const roomNames = new Map(rooms.map(r => [r.id, `${r.building} ${r.room_number}`]))
  const [[inst]] = await pool.query('SELECT id, mobility_level FROM users WHERE id = ?', [instructorId])
  const mobilityMap = { [instructorId]: inst?.mobility_level ?? 3 }
  const [priorityRows] = await pool.query('SELECT building, program, priority FROM building_priorities ORDER BY building, priority')
  const buildingPriorities = {}
  for (const r of priorityRows) (buildingPriorities[r.building] ||= {})[r.program] = r.priority

  // Everything that is NOT one of the conflicting subjects stays exactly where it is.
  const fixed = placements.filter(p => !conflictingEntries.has(p.entryId)).map(p => ({
    entryId: p.entryId, instructorId: p.instructorId, programYrSec: p.programYrSec, roomId: p.roomId,
    daysMask: p.daysMask, startMin: p.startMin, durationMin: p.durationMin, days: p.days, sessionType: p.sessionType,
  }))

  const { scheduled, unscheduled } = generateSchedule(entries, rooms, mobilityMap, buildingPriorities, fixed)
  const failedEntries = new Set(unscheduled.map(u => u.entryId))
  const rescheduled = []
  const unresolved = []

  for (const entry of entries) {
    const before = placements.filter(p => p.entryId === entry.id)
    const label = { entryId: entry.id, courseCode: entry.course_code, section: entry.program_yr_sec }
    if (failedEntries.has(entry.id)) {
      unresolved.push({ ...label, reason: unscheduled.find(u => u.entryId === entry.id)?.reason || 'No free room and time slot found.' })
      continue
    }
    const after = scheduled.filter(s => s.entryId === entry.id)
    const wasPublished = before.some(b => Number(b.row.is_published) === 1) ? 1 : 0
    await pool.query('DELETE FROM generated_schedules WHERE faculty_entry_id = ?', [entry.id])
    if (after.length) {
      await pool.query(
        `INSERT INTO generated_schedules
           (academic_year, semester, faculty_entry_id, session_type, room_id, days, start_time, end_time, is_manual, is_published)
         VALUES ?`,
        [after.map(s => [academicYear, semester, entry.id, s.sessionType, s.roomId, s.days.join(','), s.startTime, s.endTime, 0, wasPublished])]
      )
    }
    rescheduled.push({
      ...label,
      before: before.map(b => describe(b.row, roomNames)),
      after: after.map(s => `${s.days.map(d => d.slice(0, 3)).join('/')} ${s.startTime}–${s.endTime} · ${s.isOnline ? 'Online' : s.roomName}`),
    })
  }
  return { checked: movedRows.length, rescheduled, unresolved }
}
