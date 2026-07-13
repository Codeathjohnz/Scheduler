/**
 * ADSSU Scheduling Engine v2
 *
 * Optimization-aware, constraint-based scheduler.
 *
 * Hard constraints:
 *   1. No instructor teaches two sessions at the same time
 *   2. No room hosts two sessions at the same time
 *   3. No section attends two classes at the same time
 *   4. Room type must match session type (Lecture → Lecture, Lab → Laboratory)
 *   5. Sessions fit within 07:00–21:00; no crossing the 12:00–13:00 lunch break
 *   6. Mobility Level 1 (wheelchair) → only floor 1 accessible rooms
 *   7. Building program priority — once a building has a ranked program list
 *      (via building_priorities), only those programs may use its rooms.
 *      Buildings with no ranked list remain open to every program.
 *
 * Online Class fallback: if no physical room + time slot works for a LECTURE
 * session (room scarcity, no authorized building, no accessible room, etc.),
 * it is scheduled as an "Online Class" instead of going unscheduled — online
 * has no room-capacity limit, so any number of sessions can share that "room"
 * at the same time. Only the instructor/section time-conflict constraints
 * still apply. Labs and physical-activity subjects (NSTP, PATHFIT) are never
 * eligible — they require a real room regardless of scarcity, so they're left
 * unscheduled instead, which is the honest signal that more room capacity
 * (or a different time) is genuinely needed.
 *
 * Soft constraints (scored, higher = better assignment):
 *   +15 per shared day  — instructor already teaches those days (day clustering)
 *   +12                 — slot is immediately adjacent to another instructor session
 *    -3 per 30-min gap  — idle gap in the instructor's day (gap penalty)
 *   +10 / +5            — earlier start time bonus (morning preference)
 *   +20 / +10           — floor preference for Mobility Level 2 instructors
 *    +5                 — accessible room when instructor has mobility need
 *   up to +120          — building priority rank bonus (rank 1 scores highest,
 *                          tapering ~25 pts per rank), so among several buildings
 *                          a program is authorized in, its highest-priority one wins
 *
 * Session ordering (Most Constrained Variable first):
 *   1. Mobility Level 1 instructors (most room-constrained)
 *   2. Best building-priority rank of the session's program (rank 1 programs get
 *      first pick of their reserved buildings before rank 2, 3, ... compete)
 *   3. Lab sessions (fewer compatible rooms than lectures)
 *   4. Longer durations (harder time-slot fit)
 */

// ── time helpers ──────────────────────────────────────────────────────────────

export function timeToMin(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function minToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function timeOverlap(aStart, aDur, bStart, bDur) {
  return aStart < bStart + bDur && aStart + aDur > bStart
}

const DAY_BITS = {
  Monday: 1, Tuesday: 2, Wednesday: 4,
  Thursday: 8, Friday: 16, Saturday: 32,
}
function maskOf(days) {
  return days.reduce((acc, d) => acc | (DAY_BITS[d] || 0), 0)
}

// ── candidate start times: 30-min steps, 07:00–20:30, no 12:00–13:00 ─────────

const CANDIDATE_STARTS = []
for (let h = 7; h <= 20; h++) {
  for (let m = 0; m < 60; m += 30) {
    const total = h * 60 + m
    if (total >= 720 && total < 780) continue   // skip lunch
    CANDIDATE_STARTS.push(total)
  }
}

// ── meeting patterns per entry ────────────────────────────────────────────────

function buildPatterns(lecHours, labHours) {
  const sessions = []

  if (Number(lecHours) > 0) {
    const lec = Number(lecHours)
    let patterns = []
    if (lec === 3) {
      patterns = [
        { days: ['Monday', 'Wednesday', 'Friday'], durationMin: 60 },
        { days: ['Tuesday', 'Thursday'],           durationMin: 90 },
      ]
    } else if (lec === 2) {
      patterns = [
        { days: ['Tuesday', 'Thursday'],  durationMin: 60 },
        { days: ['Monday', 'Wednesday'],  durationMin: 60 },
        { days: ['Wednesday', 'Friday'],  durationMin: 60 },
      ]
    } else if (lec === 1.5) {
      patterns = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        .map(d => ({ days: [d], durationMin: 90 }))
    } else if (lec === 1) {
      patterns = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        .map(d => ({ days: [d], durationMin: 60 }))
    } else {
      patterns = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        .map(d => ({ days: [d], durationMin: lec * 60 }))
    }
    sessions.push({ sessionType: 'lecture', roomType: 'Lecture', patterns })
  }

  if (Number(labHours) > 0) {
    const labDur = Number(labHours) * 60
    sessions.push({
      sessionType: 'lab',
      roomType: 'Laboratory',
      patterns: ['Saturday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        .map(d => ({ days: [d], durationMin: labDur })),
    })
  }

  return sessions
}

// ── building program priority ─────────────────────────────────────────────────

/**
 * @param {string} building
 * @param {string|null} program
 * @param {object} buildingPriorities - { [building]: { [program]: rank } }
 * @returns {{ allowed: boolean, rank: number|null }}
 *   rank === null means the building is unmanaged (open to everyone, no bonus).
 */
function buildingAccess(building, program, buildingPriorities) {
  const rules = buildingPriorities[building]
  if (!rules || Object.keys(rules).length === 0) {
    return { allowed: true, rank: null }
  }
  if (program && Object.prototype.hasOwnProperty.call(rules, program)) {
    return { allowed: true, rank: rules[program] }
  }
  return { allowed: false, rank: null }
}

function filterRoomsByProgram(rooms, program, buildingPriorities) {
  return rooms.filter(r => buildingAccess(r.building, program, buildingPriorities).allowed)
}

// ── accessibility room filter ─────────────────────────────────────────────────

function filterRoomsByMobility(rooms, mobilityLevel) {
  if (mobilityLevel === 1) {
    // Wheelchair: must be floor 1 AND accessible
    const strict = rooms.filter(r => r.floor_level === 1 && r.is_accessible)
    // Fall back to floor 1 only if no marked-accessible rooms exist
    return strict.length > 0 ? strict : rooms.filter(r => r.floor_level === 1)
  }
  // Levels 2 & 3: no hard filter; soft scoring handles preference
  return rooms
}

// ── soft-constraint scoring ───────────────────────────────────────────────────

function scoreSlot(session, pattern, startMin, room, scheduled, buildingPriorities) {
  let score = 0
  const mask       = maskOf(pattern.days)
  const instrId    = session.instructorId
  const mobility   = session.mobilityLevel || 3

  // Building priority: reward the room's building in proportion to how highly
  // the session's program is ranked there (rank 1 = strongest bonus).
  const access = buildingAccess(room.building, session.department, buildingPriorities)
  if (access.rank != null) {
    score += Math.max(0, 120 - (access.rank - 1) * 25)
  }

  const instrSessions = instrId
    ? scheduled.filter(s => s.instructorId === instrId)
    : []

  // Day clustering: prefer days the instructor already teaches
  if (instrSessions.length > 0) {
    const instrDayMask = instrSessions.reduce((acc, s) => acc | s.daysMask, 0)
    const sharedCount  = pattern.days.filter(d => instrDayMask & DAY_BITS[d]).length
    if (sharedCount > 0) {
      score += sharedCount * 15      // +15 per shared day
    } else {
      score -= 5                     // −5 for adding a new commute day
    }
  }

  // Adjacent slot bonus: immediately before or after an existing instructor session
  const endMin = startMin + pattern.durationMin
  for (const s of instrSessions) {
    if (!(s.daysMask & mask)) continue
    if (s.startMin === endMin)                       score += 12  // this ends, next begins
    if (startMin === s.startMin + s.durationMin)     score += 12  // previous ends, this begins
  }

  // Gap penalty: idle time between sessions on the same day
  for (const s of instrSessions) {
    if (!(s.daysMask & mask)) continue
    const gapBefore = startMin - (s.startMin + s.durationMin)
    const gapAfter  = s.startMin - endMin
    if (gapBefore > 0) score -= Math.floor(gapBefore / 30) * 3
    if (gapAfter  > 0) score -= Math.floor(gapAfter  / 30) * 3
  }

  // Morning preference: 07:00–12:00 gets a bonus that fades across the day
  if (startMin < 720) {
    score += Math.max(0, 10 - Math.floor((startMin - 420) / 30))
  }

  // Floor/accessibility scoring for mobility Level 2
  if (mobility === 2) {
    if (room.floor_level === 1)      score += 20
    else if (room.floor_level === 2) score += 10
    else                             score -= 10
  }
  if (mobility <= 2 && room.is_accessible) score += 5

  return score
}

// ── online class fallback ─────────────────────────────────────────────────────

// Physical-activity subjects need a real room/field regardless of scarcity —
// never eligible for the Online fallback even though they're lec_hours-based.
function isPhysicalActivity(courseCode) {
  return /^(NSTP|PATHFIT)\s*\d/i.test(String(courseCode || '').trim())
}

// Virtual "room" for online classes — id: null means it never triggers the
// room-conflict check below, so unlimited sessions can be "in" it at once.
const ONLINE_ROOM = { id: null, building: 'Online', room_number: 'Class', room_type: null, floor_level: 1, is_accessible: 1 }

// Same time-slot search as the main loop, but with no room at all: only
// instructor and section conflicts can block a slot. Used only after every
// physical room + time combination has already failed for this session.
function tryOnlineFallback(session, scheduled) {
  let bestScore      = -Infinity
  let bestAssignment = null

  for (const pattern of session.patterns) {
    const mask = maskOf(pattern.days)

    for (const startMin of CANDIDATE_STARTS) {
      const endMin = startMin + pattern.durationMin

      if (endMin > 1260)                      continue  // must end by 21:00
      if (startMin < 720 && endMin > 720)     continue  // crosses lunch start
      if (startMin >= 720 && startMin < 780)  continue  // starts during lunch

      if (session.instructorId && scheduled.some(s =>
        s.instructorId === session.instructorId &&
        (s.daysMask & mask) &&
        timeOverlap(s.startMin, s.durationMin, startMin, pattern.durationMin)
      )) continue

      if (session.programYrSec && scheduled.some(s =>
        s.programYrSec === session.programYrSec &&
        (s.daysMask & mask) &&
        timeOverlap(s.startMin, s.durationMin, startMin, pattern.durationMin)
      )) continue

      const score = scoreSlot(session, pattern, startMin, ONLINE_ROOM, scheduled, {})
      if (score > bestScore) {
        bestScore      = score
        bestAssignment = { pattern, startMin, endMin, room: ONLINE_ROOM, mask }
      }
    }
  }

  return bestAssignment
}

// ── main scheduling function ──────────────────────────────────────────────────

/**
 * @param {object[]} entries            - faculty_load_entries rows (with `dept` = chair's department)
 * @param {object[]} rooms              - rooms rows from DB
 * @param {object}   mobilityMap        - { instructor_id: mobility_level }
 * @param {object}   buildingPriorities - { [building]: { [program]: rank } }
 */
export function generateSchedule(entries, rooms, mobilityMap = {}, buildingPriorities = {}) {

  // Best (lowest) building-priority rank a program can reach for a given room type,
  // across all buildings offering that room type. null = no reserved priority anywhere.
  const deptRankCache = {}
  function bestDeptRank(program, roomType) {
    if (!program) return null
    const key = `${program}::${roomType}`
    if (key in deptRankCache) return deptRankCache[key]
    let best = null
    for (const building of new Set(rooms.filter(r => r.room_type === roomType).map(r => r.building))) {
      const access = buildingAccess(building, program, buildingPriorities)
      if (access.allowed && access.rank != null && (best === null || access.rank < best)) {
        best = access.rank
      }
    }
    deptRankCache[key] = best
    return best
  }

  // Build all sessions from faculty load entries
  const sessions = []
  for (const entry of entries) {
    const mobility = mobilityMap[entry.assigned_instructor_id] || 3
    const department = entry.dept || null
    for (const g of buildPatterns(entry.lec_hours, entry.lab_hours)) {
      sessions.push({
        entryId:        entry.id,
        instructorId:   entry.assigned_instructor_id || null,
        instructorName: entry.instructor_name || '—',
        programYrSec:   entry.program_yr_sec || '',
        courseCode:     entry.course_code,
        title:          entry.descriptive_title,
        sessionType:    g.sessionType,
        roomType:       g.roomType,
        patterns:       g.patterns,
        mobilityLevel:  mobility,
        department,
        deptRank:       bestDeptRank(department, g.roomType),
      })
    }
  }

  // Most Constrained Variable ordering
  sessions.sort((a, b) => {
    // Level 1 mobility first (fewest valid rooms)
    const aMob = a.mobilityLevel === 1 ? 0 : 1
    const bMob = b.mobilityLevel === 1 ? 0 : 1
    if (aMob !== bMob) return aMob - bMob
    // Rank-1 reserved programs get first pick of their buildings before rank 2, 3, ...
    const aRank = a.deptRank ?? Infinity
    const bRank = b.deptRank ?? Infinity
    if (aRank !== bRank) return aRank - bRank
    // Labs before lectures (fewer compatible rooms)
    if (a.sessionType === 'lab' && b.sessionType !== 'lab') return -1
    if (b.sessionType === 'lab' && a.sessionType !== 'lab') return  1
    // Longer duration first (harder to fit)
    const aMax = Math.max(...a.patterns.map(p => p.durationMin))
    const bMax = Math.max(...b.patterns.map(p => p.durationMin))
    return bMax - aMax
  })

  const scheduled   = []
  const unscheduled = []

  for (const session of sessions) {
    const compatRooms = rooms.filter(r => r.room_type === session.roomType)
    const authorizedRooms = filterRoomsByProgram(compatRooms, session.department, buildingPriorities)
    const candidateRooms = filterRoomsByMobility(authorizedRooms, session.mobilityLevel)

    // For Level 2: sort rooms by floor preference before scanning
    const orderedRooms = session.mobilityLevel === 2
      ? [...candidateRooms].sort((a, b) => a.floor_level - b.floor_level)
      : candidateRooms

    let bestScore      = -Infinity
    let bestAssignment = null

    for (const pattern of session.patterns) {
      const mask = maskOf(pattern.days)

      for (const startMin of CANDIDATE_STARTS) {
        const endMin = startMin + pattern.durationMin

        // Hard time-boundary constraints
        if (endMin > 1260)                          continue  // must end by 21:00
        if (startMin < 720 && endMin > 720)         continue  // crosses lunch start
        if (startMin >= 720 && startMin < 780)      continue  // starts during lunch

        for (const room of orderedRooms) {
          // ① Room conflict
          if (scheduled.some(s =>
            s.roomId === room.id &&
            (s.daysMask & mask) &&
            timeOverlap(s.startMin, s.durationMin, startMin, pattern.durationMin)
          )) continue

          // ② Instructor conflict
          if (session.instructorId && scheduled.some(s =>
            s.instructorId === session.instructorId &&
            (s.daysMask & mask) &&
            timeOverlap(s.startMin, s.durationMin, startMin, pattern.durationMin)
          )) continue

          // ③ Section conflict — a section (this course's own Lec vs Lab
          // sessions included, same entryId) can never attend two sessions
          // at once, so this must never exclude same-entry sessions.
          if (session.programYrSec && scheduled.some(s =>
            s.programYrSec === session.programYrSec &&
            (s.daysMask & mask) &&
            timeOverlap(s.startMin, s.durationMin, startMin, pattern.durationMin)
          )) continue

          // ✅ Valid — score and keep if best so far
          const score = scoreSlot(session, pattern, startMin, room, scheduled, buildingPriorities)
          if (score > bestScore) {
            bestScore      = score
            bestAssignment = { pattern, startMin, endMin, room, mask }
          }
        }
      }
    }

    // No physical room + time combination worked (room scarcity, no authorized
    // building, no accessible room, or every slot already taken) — fall back to
    // an Online Class instead of leaving the session unscheduled. Labs and
    // physical-activity subjects are prioritized for physical rooms and are
    // never moved online; a real room is a hard requirement for them.
    const canGoOnline = session.sessionType === 'lecture' && !isPhysicalActivity(session.courseCode)
    let wentOnline = false
    if (!bestAssignment && canGoOnline) {
      bestAssignment = tryOnlineFallback(session, scheduled)
      wentOnline = !!bestAssignment
    }

    if (bestAssignment) {
      const { pattern, startMin, endMin, room, mask } = bestAssignment
      scheduled.push({
        entryId:        session.entryId,
        instructorId:   session.instructorId,
        instructorName: session.instructorName,
        programYrSec:   session.programYrSec,
        courseCode:     session.courseCode,
        title:          session.title,
        sessionType:    session.sessionType,
        mobilityLevel:  session.mobilityLevel,
        roomId:         room.id,
        roomName:       wentOnline ? 'Online Class' : `${room.building} ${room.room_number}`,
        roomType:       room.room_type,
        floorLevel:     room.floor_level,
        isOnline:       wentOnline,
        days:           pattern.days,
        daysMask:       mask,
        startMin,
        durationMin:    pattern.durationMin,
        startTime:      minToTime(startMin),
        endTime:        minToTime(endMin),
        score:          bestScore,
      })
    } else {
      let reason
      if (!canGoOnline) {
        reason = session.mobilityLevel === 1
          ? `No accessible ground-floor ${session.roomType} room available (labs/physical-activity subjects require a real room, never online)`
          : `No ${session.roomType} room available (labs/physical-activity subjects require a real room, never online)`
      } else {
        reason = session.mobilityLevel === 1
          ? 'No accessible ground-floor room + time slot combination available, even as an Online Class'
          : 'No available time slot found, even as an Online Class'
      }
      unscheduled.push({ ...session, reason })
    }
  }

  return { scheduled, unscheduled }
}

// ── conflict detector (for saved schedule rows) ───────────────────────────────

export function detectConflicts(rows) {
  const conflicts = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]; const b = rows[j]
      const aDays    = a.days.split(',')
      const bDays    = b.days.split(',')
      const sharedDay = aDays.some(d => bDays.includes(d))
      if (!sharedDay) continue

      const aStart = timeToMin(a.start_time); const aEnd = timeToMin(a.end_time)
      const bStart = timeToMin(b.start_time); const bEnd = timeToMin(b.end_time)
      if (!timeOverlap(aStart, aEnd - aStart, bStart, bEnd - bStart)) continue

      if (a.room_id && a.room_id === b.room_id) {
        conflicts.push({
          type: 'room', ids: [a.id, b.id],
          message: `Room conflict: ${a.room_name} used by "${a.course_code}" and "${b.course_code}" at the same time`,
        })
      }
      if (a.instructor_id && a.instructor_id === b.instructor_id) {
        conflicts.push({
          type: 'instructor', ids: [a.id, b.id],
          message: `Instructor conflict: ${a.instructor_name} assigned to "${a.course_code}" and "${b.course_code}" at the same time`,
        })
      }
      if (a.program_yr_sec && a.program_yr_sec === b.program_yr_sec) {
        conflicts.push({
          type: 'section', ids: [a.id, b.id],
          message: `Section conflict: ${a.program_yr_sec} has "${a.course_code}" and "${b.course_code}" at the same time`,
        })
      }
    }
  }
  return conflicts
}
