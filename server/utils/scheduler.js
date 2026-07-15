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

// ── session builder (shared by both the greedy and genetic engines) ──────────

/**
 * @param {object[]} entries            - faculty_load_entries rows (with `dept` = chair's department)
 * @param {object[]} rooms              - rooms rows from DB
 * @param {object}   mobilityMap        - { instructor_id: mobility_level }
 * @param {object}   buildingPriorities - { [building]: { [program]: rank } }
 */
export function buildSessions(entries, rooms, mobilityMap, buildingPriorities) {
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
  return sessions
}

// ── main scheduling function (greedy constructive heuristic) ─────────────────

export function generateSchedule(entries, rooms, mobilityMap = {}, buildingPriorities = {}) {
  const sessions = buildSessions(entries, rooms, mobilityMap, buildingPriorities)

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

// ── genetic algorithm engine ──────────────────────────────────────────────────
//
// A real evolutionary alternative to the greedy engine above. Where the greedy
// engine commits to each session's placement permanently, one at a time, and
// can never undo an early choice that blocks a better later one, the GA
// evaluates COMPLETE candidate schedules (chromosomes) and evolves the
// population toward fewer constraint violations and higher soft-constraint
// scores over many generations — able to discover beneficial trade-off swaps
// (e.g. moving session A to a slightly worse slot so session B can take a
// much better one) that a one-pass greedy algorithm structurally cannot.
//
// Chromosome: one gene per session (same session list buildSessions() returns).
// A gene is either { type:'room', roomIdx, patternIdx, startMin },
// { type:'online', patternIdx, startMin } (lecture-only, same rule as greedy),
// or { type:'none' } (unscheduled). Hard constraints that depend only on the
// session itself (room type, building authorization, accessibility) are
// satisfied by construction — a gene only ever picks from that session's own
// precomputed valid room list. Hard constraints that depend on OTHER
// sessions' choices (room/instructor/section double-booking) are NOT
// prevented by construction; they're penalized in the fitness function, and
// selection pressure drives the population away from them across generations.

const HARD_CONFLICT_PENALTY = 100000   // room/instructor/section double-booking
const UNSCHEDULED_PENALTY   = 4000     // softer than a real conflict, but still discouraged

export function precomputeSessionCandidates(sessions, rooms, buildingPriorities) {
  const validStartsCache = new Map()   // durationMin -> valid startMin[]
  function validStartsFor(durationMin) {
    if (validStartsCache.has(durationMin)) return validStartsCache.get(durationMin)
    const starts = CANDIDATE_STARTS.filter(startMin => {
      const endMin = startMin + durationMin
      if (endMin > 1260) return false
      if (startMin < 720 && endMin > 720) return false
      if (startMin >= 720 && startMin < 780) return false
      return true
    })
    validStartsCache.set(durationMin, starts)
    return starts
  }

  return sessions.map(session => {
    const compatRooms     = rooms.filter(r => r.room_type === session.roomType)
    const authorizedRooms = filterRoomsByProgram(compatRooms, session.department, buildingPriorities)
    const candidateRooms  = filterRoomsByMobility(authorizedRooms, session.mobilityLevel)
    const canGoOnline      = session.sessionType === 'lecture' && !isPhysicalActivity(session.courseCode)
    return {
      session,
      candidateRooms,
      canGoOnline,
      startsByPattern: session.patterns.map(p => validStartsFor(p.durationMin)),
    }
  })
}

function randomGene(cand) {
  const canRoom   = cand.candidateRooms.length > 0
  const options   = []
  if (canRoom)          options.push('room')
  if (cand.canGoOnline) options.push('online')
  if (options.length === 0) return { type: 'none' }

  const type = options[Math.floor(Math.random() * options.length)]
  const patternIdx = Math.floor(Math.random() * cand.session.patterns.length)
  const starts = cand.startsByPattern[patternIdx]
  if (!starts.length) return { type: 'none' }
  const startMin = starts[Math.floor(Math.random() * starts.length)]

  if (type === 'room') {
    const roomIdx = Math.floor(Math.random() * cand.candidateRooms.length)
    return { type: 'room', roomIdx, patternIdx, startMin }
  }
  return { type: 'online', patternIdx, startMin }
}

// Convert a greedy generateSchedule() result into gene form, for seeding —
// guarantees the GA's best-ever individual is never worse than plain greedy,
// and gives evolution a strong starting point to refine rather than search
// from scratch.
function seedFromGreedy(sessions, candidates, entries, rooms, mobilityMap, buildingPriorities) {
  const { scheduled } = generateSchedule(entries, rooms, mobilityMap, buildingPriorities)
  const byKey = new Map(scheduled.map(s => [`${s.entryId}::${s.sessionType}`, s]))

  return sessions.map((session, i) => {
    const hit = byKey.get(`${session.entryId}::${session.sessionType}`)
    if (!hit) return { type: 'none' }
    const cand = candidates[i]
    const patternIdx = session.patterns.findIndex(p =>
      p.durationMin === hit.durationMin && p.days.join(',') === hit.days.join(',')
    )
    if (patternIdx === -1) return randomGene(cand)
    if (hit.isOnline) return { type: 'online', patternIdx, startMin: hit.startMin }
    const roomIdx = cand.candidateRooms.findIndex(r => r.id === hit.roomId)
    if (roomIdx === -1) return randomGene(cand)
    return { type: 'room', roomIdx, patternIdx, startMin: hit.startMin }
  })
}

function geneToPlacement(gene, cand) {
  if (gene.type === 'none') return null
  const session = cand.session
  const pattern = session.patterns[gene.patternIdx]
  const room    = gene.type === 'online' ? ONLINE_ROOM : cand.candidateRooms[gene.roomIdx]
  if (!pattern || !room) return null
  return {
    session, pattern, room,
    roomId:       gene.type === 'online' ? null : room.id,
    daysMask:     maskOf(pattern.days),
    startMin:     gene.startMin,
    durationMin:  pattern.durationMin,
    isOnline:     gene.type === 'online',
  }
}

function evaluateFitness(genes, candidates, buildingPriorities) {
  const placements = []
  for (let i = 0; i < genes.length; i++) {
    const p = geneToPlacement(genes[i], candidates[i])
    if (p) placements.push(p)
  }

  let hardPenalty = 0
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i]
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j]
      if (!(a.daysMask & b.daysMask)) continue
      if (!timeOverlap(a.startMin, a.durationMin, b.startMin, b.durationMin)) continue
      if (a.roomId != null && a.roomId === b.roomId) hardPenalty += HARD_CONFLICT_PENALTY
      if (a.session.instructorId && a.session.instructorId === b.session.instructorId) hardPenalty += HARD_CONFLICT_PENALTY
      if (a.session.programYrSec && a.session.programYrSec === b.session.programYrSec) hardPenalty += HARD_CONFLICT_PENALTY
    }
  }

  // Soft-constraint score — reuse the exact same scoreSlot() the greedy engine
  // uses, evaluated against each placement's final instructor-mates so both
  // engines are judged by (and optimize toward) the same quality definition.
  let softScore = 0
  for (const p of placements) {
    const instrMates = p.session.instructorId
      ? placements.filter(o => o !== p && o.session.instructorId === p.session.instructorId).map(o => ({
          instructorId: o.session.instructorId, daysMask: o.daysMask, startMin: o.startMin, durationMin: o.durationMin,
        }))
      : []
    softScore += scoreSlot(p.session, p.pattern, p.startMin, p.room, instrMates, buildingPriorities)
  }

  const unscheduledCount = genes.length - placements.length
  const fitness = softScore - hardPenalty - unscheduledCount * UNSCHEDULED_PENALTY
  return { fitness, hardPenalty, unscheduledCount, placements }
}

function tournamentSelect(population, fitnesses, size) {
  let best = null, bestFit = -Infinity
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(Math.random() * population.length)
    if (fitnesses[idx] > bestFit) { bestFit = fitnesses[idx]; best = population[idx] }
  }
  return best
}

/**
 * Same signature/output shape as generateSchedule() — a drop-in alternative
 * engine. Options let the caller trade runtime for solution quality.
 * @param {object} [options]
 * @param {number} [options.populationSize=40]
 * @param {number} [options.generations=60]
 * @param {number} [options.mutationRate=0.08]
 * @param {number} [options.eliteCount=3]
 * @param {number} [options.tournamentSize=3]
 * @param {number} [options.maxTimeMs=20000]  - hard wall-clock cap; returns the
 *   best individual found so far if generations aren't finished in time, since
 *   this runs synchronously on the request thread and must not hang the server.
 * @param {number} [options.patience=20]      - stop early if the best fitness
 *   hasn't improved for this many generations
 */
export function generateScheduleGA(entries, rooms, mobilityMap = {}, buildingPriorities = {}, options = {}) {
  const {
    populationSize = 40,
    generations    = 60,
    mutationRate   = 0.08,
    eliteCount     = 3,
    tournamentSize = 3,
    maxTimeMs      = 20000,
    patience       = 20,
  } = options

  const sessions   = buildSessions(entries, rooms, mobilityMap, buildingPriorities)
  const candidates = precomputeSessionCandidates(sessions, rooms, buildingPriorities)

  if (sessions.length === 0) return { scheduled: [], unscheduled: [], engine: 'genetic', generationsRun: 0 }

  // Seed one individual from the greedy engine's own result (elitism then
  // guarantees the GA never does worse than plain greedy), fill the rest of
  // the population with random valid-structure individuals.
  const population = [seedFromGreedy(sessions, candidates, entries, rooms, mobilityMap, buildingPriorities)]
  while (population.length < populationSize) {
    population.push(sessions.map((_, i) => randomGene(candidates[i])))
  }

  const startTime = Date.now()
  let bestGenes = population[0]
  let bestResult = evaluateFitness(bestGenes, candidates, buildingPriorities)
  let generationsSinceImprovement = 0
  let generationsRun = 0

  for (let gen = 0; gen < generations; gen++) {
    if (Date.now() - startTime > maxTimeMs) break

    const evaluated = population.map(genes => evaluateFitness(genes, candidates, buildingPriorities))
    const fitnesses = evaluated.map(e => e.fitness)

    // Track the best individual ever seen (elitism alone should preserve it,
    // but tracking explicitly is cheap insurance against an implementation slip)
    let genBestIdx = 0
    for (let i = 1; i < evaluated.length; i++) if (fitnesses[i] > fitnesses[genBestIdx]) genBestIdx = i
    if (fitnesses[genBestIdx] > bestResult.fitness) {
      bestResult = evaluated[genBestIdx]
      bestGenes  = population[genBestIdx]
      generationsSinceImprovement = 0
    } else {
      generationsSinceImprovement++
    }

    generationsRun = gen + 1
    if (generationsSinceImprovement >= patience) break
    if (gen === generations - 1) break   // last generation — no need to build a next one

    // Next generation: elitism + tournament-selected crossover/mutation
    const order = [...population.keys()].sort((a, b) => fitnesses[b] - fitnesses[a])
    const next = order.slice(0, eliteCount).map(idx => population[idx])

    while (next.length < populationSize) {
      const parentA = tournamentSelect(population, fitnesses, tournamentSize)
      const parentB = tournamentSelect(population, fitnesses, tournamentSize)
      const child = sessions.map((_, i) => {
        let gene = Math.random() < 0.5 ? parentA[i] : parentB[i]
        if (Math.random() < mutationRate) gene = randomGene(candidates[i])
        return gene
      })
      next.push(child)
    }
    population.length = 0
    population.push(...next)
  }

  // Convert the best chromosome found into the same { scheduled, unscheduled }
  // shape generateSchedule() returns, so callers can use either engine
  // interchangeably.
  const scheduled = []
  const unscheduled = []
  for (let i = 0; i < bestGenes.length; i++) {
    const gene = bestGenes[i]
    const cand = candidates[i]
    const session = cand.session
    const placement = geneToPlacement(gene, cand)
    if (!placement) {
      const reason = cand.candidateRooms.length === 0 && !cand.canGoOnline
        ? `No ${session.roomType} room available (labs/physical-activity subjects require a real room, never online)`
        : 'The genetic algorithm could not find a conflict-free placement within its generation budget'
      unscheduled.push({ ...session, reason })
      continue
    }
    scheduled.push({
      entryId:        session.entryId,
      instructorId:   session.instructorId,
      instructorName: session.instructorName,
      programYrSec:   session.programYrSec,
      courseCode:     session.courseCode,
      title:          session.title,
      sessionType:    session.sessionType,
      mobilityLevel:  session.mobilityLevel,
      roomId:         placement.roomId,
      roomName:       placement.isOnline ? 'Online Class' : `${placement.room.building} ${placement.room.room_number}`,
      roomType:       placement.room.room_type,
      floorLevel:     placement.room.floor_level,
      isOnline:       placement.isOnline,
      days:           placement.pattern.days,
      daysMask:       placement.daysMask,
      startMin:       placement.startMin,
      durationMin:    placement.durationMin,
      startTime:      minToTime(placement.startMin),
      endTime:        minToTime(placement.startMin + placement.durationMin),
    })
  }

  return {
    scheduled, unscheduled,
    engine: 'genetic',
    generationsRun,
    finalFitness: bestResult.fitness,
    hardConflicts: bestResult.hardPenalty / HARD_CONFLICT_PENALTY,
    runtimeMs: Date.now() - startTime,
  }
}

// ── OR-Tools (Google CP-SAT) engine ───────────────────────────────────────────
//
// Unlike the greedy and genetic engines above — which are entirely custom
// JavaScript — this delegates the actual constraint solve to Google's
// OR-Tools CP-SAT solver, running as a separate Python microservice
// (or-tools-service/). Node precomputes the same candidate universe the
// other two engines use (buildSessions + precomputeSessionCandidates) and
// sends it as a flat list of (session, room-or-online, pattern) options;
// the Python side builds a real constraint-programming model — NoOverlap
// interval constraints per room/instructor/section, per day — so hard
// constraints are a solver guarantee, not a penalty term the way the GA's
// fitness function treats them. See or-tools-service/main.py for the model.
//
// The per-option score sent over only covers the parts of scoreSlot() that
// don't depend on other sessions (building priority, mobility/floor fit) —
// day-clustering/adjacency/gap-penalty terms are a documented simplification,
// not modeled here yet (they'd need reified product variables per
// instructor-pair to encode safely in CP-SAT).

// Static (session+room only, no dependency on other placements) subset of
// scoreSlot()'s scoring — the only kind of term safe to send as a per-option
// constant to a solver that evaluates all sessions simultaneously.
function computeStaticScore(session, room, buildingPriorities) {
  let score = 0
  const access = buildingAccess(room.building, session.department, buildingPriorities)
  if (access.rank != null) score += Math.max(0, 120 - (access.rank - 1) * 25)

  const mobility = session.mobilityLevel || 3
  if (mobility === 2) {
    if (room.floor_level === 1)      score += 20
    else if (room.floor_level === 2) score += 10
    else                              score -= 10
  }
  if (mobility <= 2 && room.is_accessible) score += 5

  return score
}

/**
 * Same signature/output shape as generateSchedule()/generateScheduleGA() —
 * a drop-in alternative engine, except this one is async (it makes an HTTP
 * call to the Python solver service).
 * @param {object} [options]
 * @param {string} [options.serviceUrl] - defaults to process.env.OR_TOOLS_SERVICE_URL
 *   or http://localhost:8091 for local dev.
 * @param {number} [options.maxTimeSeconds=20]
 */
export async function generateScheduleORTools(entries, rooms, mobilityMap = {}, buildingPriorities = {}, options = {}) {
  const serviceUrl = options.serviceUrl || process.env.OR_TOOLS_SERVICE_URL || 'http://localhost:8091'
  const maxTimeSeconds = options.maxTimeSeconds || 20

  const sessions   = buildSessions(entries, rooms, mobilityMap, buildingPriorities)
  const candidates = precomputeSessionCandidates(sessions, rooms, buildingPriorities)

  if (sessions.length === 0) return { scheduled: [], unscheduled: [], engine: 'ortools' }

  // Metadata parallel to each session's `options` array (roomIdx/patternIdx/
  // isOnline per option) — kept out of the wire payload, used only to locate
  // the matching option index when converting the greedy warm-start below.
  const optMeta = []

  const payload = {
    maxTimeSeconds,
    sessions: sessions.map((session, i) => {
      const cand = candidates[i]
      const opts = []
      const meta = []
      cand.candidateRooms.forEach((room, roomIdx) => {
        session.patterns.forEach((pattern, patternIdx) => {
          const starts = cand.startsByPattern[patternIdx]
          if (!starts.length) return
          opts.push({
            isOnline: false,
            roomId: room.id,
            days: pattern.days,
            durationMin: pattern.durationMin,
            baseScore: computeStaticScore(session, room, buildingPriorities),
            startOptions: starts,
          })
          meta.push({ isOnline: false, roomIdx, patternIdx })
        })
      })
      if (cand.canGoOnline) {
        session.patterns.forEach((pattern, patternIdx) => {
          const starts = cand.startsByPattern[patternIdx]
          if (!starts.length) return
          opts.push({
            isOnline: true,
            roomId: null,
            days: pattern.days,
            durationMin: pattern.durationMin,
            baseScore: 0,
            startOptions: starts,
          })
          meta.push({ isOnline: true, roomIdx: -1, patternIdx })
        })
      }
      optMeta.push(meta)
      return { index: i, instructorId: session.instructorId, programYrSec: session.programYrSec, options: opts }
    }),
  }

  // Warm-start: seed the solver with the greedy engine's own solution
  // (converted to gene form via the same helper the GA uses) so CP-SAT
  // always has a feasible incumbent to start from — a hard time budget can
  // then never return UNKNOWN/no-solution the way a cold random search can
  // on a large real-world instance, mirroring the GA's "never worse than
  // greedy" guarantee.
  const seedGenes = seedFromGreedy(sessions, candidates, entries, rooms, mobilityMap, buildingPriorities)
  const hints = []
  seedGenes.forEach((gene, i) => {
    if (gene.type === 'none') return
    const k = optMeta[i].findIndex(m =>
      m.isOnline === (gene.type === 'online') &&
      m.patternIdx === gene.patternIdx &&
      (gene.type === 'online' || m.roomIdx === gene.roomIdx)
    )
    if (k === -1) return
    hints.push({ sessionIndex: i, optionIndex: k, startMin: gene.startMin })
  })
  payload.hints = hints

  const startTime = Date.now()
  let response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), (maxTimeSeconds + 15) * 1000)
    response = await fetch(`${serviceUrl}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeout)
  } catch (err) {
    throw new Error(`OR-Tools service unreachable at ${serviceUrl}: ${err.message}`)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OR-Tools service returned ${response.status}: ${text.slice(0, 300)}`)
  }
  const result = await response.json()

  if (!['OPTIMAL', 'FEASIBLE'].includes(result.status)) {
    throw new Error(`OR-Tools could not solve this term (status: ${result.status}).`)
  }

  // Rebuild each option's (room, pattern) objects from the same candidates
  // array Node already has — the Python side only echoes back indices, it
  // never sees or needs to know about room/pattern objects directly.
  const optionRefs = sessions.map((session, i) => {
    const cand = candidates[i]
    const refs = []
    cand.candidateRooms.forEach(room => {
      session.patterns.forEach((pattern, patternIdx) => {
        if (!cand.startsByPattern[patternIdx].length) return
        refs.push({ isOnline: false, room, pattern })
      })
    })
    if (cand.canGoOnline) {
      session.patterns.forEach((pattern, patternIdx) => {
        if (!cand.startsByPattern[patternIdx].length) return
        refs.push({ isOnline: true, room: ONLINE_ROOM, pattern })
      })
    }
    return refs
  })

  const scheduled = []
  const unscheduled = []
  for (const a of result.assignments) {
    const session = sessions[a.sessionIndex]
    if (!a.scheduled) {
      const cand = candidates[a.sessionIndex]
      const reason = cand.candidateRooms.length === 0 && !cand.canGoOnline
        ? `No ${session.roomType} room available (labs/physical-activity subjects require a real room, never online)`
        : 'OR-Tools could not find a conflict-free placement within its time budget'
      unscheduled.push({ ...session, reason })
      continue
    }
    const ref = optionRefs[a.sessionIndex][a.optionIndex]
    const daysMask = maskOf(ref.pattern.days)
    scheduled.push({
      entryId:        session.entryId,
      instructorId:   session.instructorId,
      instructorName: session.instructorName,
      programYrSec:   session.programYrSec,
      courseCode:     session.courseCode,
      title:          session.title,
      sessionType:    session.sessionType,
      mobilityLevel:  session.mobilityLevel,
      roomId:         ref.isOnline ? null : ref.room.id,
      roomName:       ref.isOnline ? 'Online Class' : `${ref.room.building} ${ref.room.room_number}`,
      roomType:       ref.room.room_type,
      floorLevel:     ref.room.floor_level,
      isOnline:       ref.isOnline,
      days:           ref.pattern.days,
      daysMask,
      startMin:       a.startMin,
      durationMin:    ref.pattern.durationMin,
      startTime:      minToTime(a.startMin),
      endTime:        minToTime(a.startMin + ref.pattern.durationMin),
    })
  }

  return {
    scheduled, unscheduled,
    engine: 'ortools',
    solverStatus: result.status,
    objectiveValue: result.objectiveValue,
    solverWallTimeSeconds: result.wallTimeSeconds,
    runtimeMs: Date.now() - startTime,
  }
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
