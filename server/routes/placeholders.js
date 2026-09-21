import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { getCombinedLoadMap, MAX_UNITS, TARGET_UNITS, syncConfirmation } from './facultyload.js'
import { rescheduleConflicts } from '../utils/rescheduleEntries.js'
import { notify, adminIds, deanIds } from '../utils/notify.js'

/**
 * Placeholder instructors — "Instructor A, B, C…"
 *
 * A subject nobody can teach yet is parked on a placeholder so the faculty load
 * can still be completed, approved, and scheduled. A placeholder is an ordinary
 * (hidden, login-less) instructor row, so everything that already works for
 * people — the 21/27 unit cap, schedule conflict checks, the load sheet — works
 * for it too. Its "specialty" is simply the subjects it holds, and when a real
 * instructor whose specialties match arrives, the chair swaps them in.
 *
 * WHO CONFIRMS A SWAP (deliberately not the whole approval chain again): the
 * subjects, sections, units and total load that were approved don't change —
 * only the name on them does. So the CHAIR makes the swap, the NEW INSTRUCTOR
 * confirms their own load with one click, and the DEAN and REGISTRAR are
 * notified (not asked) and can see it in the change log. Anything unusual —
 * over the 21-unit standard load, or no matching specialty — needs a written
 * reason and is flagged "exception" to the Dean. The 27-unit cap can never be
 * exceeded, and only same-department instructors (plus the shared GE/PATHFIT/
 * NSTP pools for those subjects) can be swapped in directly; anyone else goes
 * through the cross-department request flow.
 */
const router = Router()

const POOLS = [['General Education', /^GE\b/i], ['PATHFIT', /^PATHFIT\b/i], ['NSTP', /^NSTP\b/i]]
const poolOf = (code) => POOLS.find(([, re]) => re.test(String(code || '').trim()))?.[0] || null
const isNstp = (code) => /^NSTP\b/i.test(String(code || '').trim())
// Unit credit toward the cap: Lec + Lab×0.75; NSTP never counts (same rule as the rest of the system).
const creditOf = (e) => isNstp(e.course_code) ? 0 : Number(e.lec_hours || 0) + Number(e.lab_hours || 0) * 0.75
const norm = (s) => String(s || '').trim().toUpperCase()
const SEM = { 1: '1st', 2: '2nd', 3: 'Summer' }

// "MATH 101 (1A, 1B, 1C), MATH 102 (1A)" — sections grouped under their subject so
// notifications stay readable when a placeholder held many.
function summarize(entries) {
  const bySubject = new Map()
  for (const e of entries) {
    if (!bySubject.has(e.course_code)) bySubject.set(e.course_code, [])
    bySubject.get(e.course_code).push(String(e.program_yr_sec || '').split(' ').pop())
  }
  return [...bySubject].map(([code, secs]) => `${code} (${secs.join(', ')})`).join(', ')
}

// A, B, … Z, AA, AB … — the label after "Instructor".
function letterFor(index) {
  let n = index, out = ''
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return out
}

// Can `candidate` take this entry directly? Their own department's major
// subjects, or a shared-pool subject from that pool's department.
function canTeachEntry(candidate, chairDept, entry) {
  const sharedPool = poolOf(entry.course_code)
  return sharedPool ? candidate.department === sharedPool : candidate.department === chairDept
}

async function chairInfo(chairId) {
  const [[chair]] = await pool.query('SELECT id, name, department FROM users WHERE id = ?', [chairId])
  const [[prog]] = await pool.query('SELECT program FROM prospectus WHERE uploaded_by = ? ORDER BY created_at DESC LIMIT 1', [chairId])
  return { ...chair, program: prog?.program || null }
}

async function myPlaceholders(chairId) {
  const [rows] = await pool.query('SELECT id, name FROM users WHERE is_placeholder = 1 AND placeholder_owner = ? ORDER BY id', [chairId])
  return rows
}

// ── POST /api/placeholders/fill ────────────────────────────────────────────────
// Park every still-unassigned subject on "Instructor A/B/C…" (21 units each,
// all sections of a subject kept together), reusing existing placeholders that
// still have room before creating a new one.
router.post('/fill', authenticate, authorize('chair'), async (req, res) => {
  const { academic_year, semester } = req.body
  if (!academic_year || !semester) return res.status(400).json({ message: 'academic_year and semester are required.' })
  try {
    const chair = await chairInfo(req.user.id)
    const [entries] = await pool.query(
      `SELECT e.* FROM faculty_load_entries e
       WHERE e.chair_id = ? AND e.academic_year = ? AND e.semester = ? AND e.assigned_instructor_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM cross_dept_requests r WHERE r.entry_id = e.id AND r.status IN ('pending_instructor', 'pending_home'))
       ORDER BY e.year_level, e.subject_id, e.id`,
      [req.user.id, academic_year, semester]
    )
    if (!entries.length) return res.json({ assigned: 0, created: 0, message: 'Nothing is unassigned.' })

    const loadMap = await getCombinedLoadMap(academic_year, semester)
    const holders = (await myPlaceholders(req.user.id)).map(p => ({ ...p, load: loadMap[p.id] || 0 }))
    let created = 0
    const stickyBySubject = new Map()
    const assignedBy = new Map()   // placeholder id → entry ids

    for (const e of entries) {
      const credit = creditOf(e)
      let target = null
      const sticky = holders.find(h => h.id === stickyBySubject.get(e.subject_id))
      if (sticky && sticky.load + credit <= TARGET_UNITS) target = sticky
      if (!target) target = holders.find(h => h.load + credit <= TARGET_UNITS)
      if (!target) {
        const index = holders.length
        const username = `placeholder_${req.user.id}_${index + 1}_${Date.now().toString(36)}`
        const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 4)   // never used — placeholders can't log in
        const [r] = await pool.query(
          `INSERT INTO users (username, password_hash, name, role, department, is_placeholder, placeholder_owner)
           VALUES (?, ?, ?, 'instructor', ?, 1, ?)`,
          [username, hash, `Instructor ${letterFor(index)}`, chair.department, req.user.id]
        )
        target = { id: r.insertId, name: `Instructor ${letterFor(index)}`, load: 0 }
        holders.push(target)
        created++
      }
      target.load += credit
      if (e.subject_id) stickyBySubject.set(e.subject_id, target.id)
      if (!assignedBy.has(target.id)) assignedBy.set(target.id, [])
      assignedBy.get(target.id).push(e.id)
    }
    for (const [id, entryIds] of assignedBy) {
      await pool.query('UPDATE faculty_load_entries SET assigned_instructor_id = ? WHERE id IN (?)', [id, entryIds])
    }
    res.json({
      assigned: entries.length, created,
      message: `${entries.length} unassigned subject${entries.length > 1 ? 's' : ''} placed on ${assignedBy.size} placeholder instructor${assignedBy.size > 1 ? 's' : ''}${created ? ` (${created} new)` : ''}.`,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/placeholders?year=&semester= ──────────────────────────────────────
// Each placeholder with the subjects it holds (its "specialty basis") and the
// real instructors who could take it over, best specialty match first.
router.get('/', authenticate, authorize('chair'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const chair = await chairInfo(req.user.id)
    const holders = await myPlaceholders(req.user.id)
    if (!holders.length) return res.json([])

    const [entries] = await pool.query(
      `SELECT e.id, e.assigned_instructor_id, e.subject_id, e.course_code, e.descriptive_title, e.program_yr_sec,
              e.units, e.lec_hours, e.lab_hours
       FROM faculty_load_entries e
       WHERE e.assigned_instructor_id IN (?) AND e.academic_year = ? AND e.semester = ?
       ORDER BY e.year_level, e.course_code, e.program_yr_sec`,
      [holders.map(h => h.id), year, semester]
    )
    const loadMap = await getCombinedLoadMap(year, semester)

    const poolDepts = [...new Set(entries.map(e => poolOf(e.course_code)).filter(Boolean))]
    const [cands] = await pool.query(
      `SELECT id, name, department, role, programs FROM users
       WHERE role IN ('instructor', 'chair', 'dean') AND is_placeholder = 0
         AND (department = ? ${poolDepts.length ? 'OR department IN (?)' : ''})`,
      poolDepts.length ? [chair.department, poolDepts] : [chair.department]
    )
    // Honour "I only teach BSIS": an instructor tagged for other programs isn't offered a BSIT placeholder.
    const candidates = cands.filter(c => {
      const list = String(c.programs || '').split(',').map(norm).filter(Boolean)
      return !list.length || !chair.program || list.includes(norm(chair.program))
    })
    const [specs] = candidates.length ? await pool.query(
      `SELECT isp.instructor_id, isp.priority, ps.id AS subject_id, ps.course_code
       FROM instructor_specialties isp JOIN prospectus_subjects ps ON ps.id = isp.subject_id
       WHERE isp.instructor_id IN (?)`, [candidates.map(c => c.id)]
    ) : [[]]

    const out = []
    for (const h of holders) {
      const mine = entries.filter(e => e.assigned_instructor_id === h.id)
      if (!mine.length) continue
      const bySubject = new Map()
      for (const e of mine) {
        const key = norm(e.course_code)
        if (!bySubject.has(key)) bySubject.set(key, { subject_id: e.subject_id, course_code: e.course_code, title: e.descriptive_title, sections: [] })
        bySubject.get(key).sections.push({ entry_id: e.id, section: e.program_yr_sec, credit: creditOf(e) })
      }
      const subjects = [...bySubject.values()]

      const suggestions = candidates.map(c => {
        const eligible = mine.filter(e => canTeachEntry(c, chair.department, e))
        if (!eligible.length) return null
        const matched = subjects.filter(s => specs.some(sp => sp.instructor_id === c.id &&
          (sp.subject_id === s.subject_id || norm(sp.course_code) === norm(s.course_code))))
        const current = loadMap[c.id] || 0
        const movable = eligible.reduce((a, e) => a + creditOf(e), 0)
        const projected = current + movable
        return {
          id: c.id, name: c.name, department: c.department, role: c.role,
          matched_subjects: matched.map(s => s.title),
          eligible_entry_ids: eligible.map(e => e.id),
          current_units: current, movable_units: movable, projected_units: projected,
          fits: projected <= MAX_UNITS,
          exception: projected > TARGET_UNITS || matched.length === 0,
        }
      }).filter(Boolean).sort((a, b) => b.matched_subjects.length - a.matched_subjects.length || a.current_units - b.current_units)

      out.push({
        id: h.id, name: h.name,
        units: mine.reduce((a, e) => a + creditOf(e), 0),
        subjects,
        suggestions,
      })
    }
    res.json(out)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── POST /api/placeholders/:id/replace ─────────────────────────────────────────
router.post('/:id/replace', authenticate, authorize('chair'), async (req, res) => {
  const { instructor_id, entry_ids, reason, academic_year, semester } = req.body
  if (!instructor_id || !academic_year || !semester) return res.status(400).json({ message: 'instructor_id, academic_year and semester are required.' })
  try {
    const [[ph]] = await pool.query('SELECT id, name FROM users WHERE id = ? AND is_placeholder = 1 AND placeholder_owner = ?', [req.params.id, req.user.id])
    if (!ph) return res.status(404).json({ message: 'Placeholder not found.' })
    const chair = await chairInfo(req.user.id)
    const [[inst]] = await pool.query(
      "SELECT id, name, department, role, programs FROM users WHERE id = ? AND is_placeholder = 0 AND role IN ('instructor', 'chair', 'dean')", [instructor_id]
    )
    if (!inst) return res.status(404).json({ message: 'Instructor not found.' })

    const [held] = await pool.query(
      `SELECT id, subject_id, course_code, descriptive_title, program_yr_sec, lec_hours, lab_hours
       FROM faculty_load_entries WHERE assigned_instructor_id = ? AND chair_id = ? AND academic_year = ? AND semester = ?`,
      [ph.id, req.user.id, academic_year, semester]
    )
    let chosen = Array.isArray(entry_ids) && entry_ids.length ? held.filter(e => entry_ids.includes(e.id)) : held
    const eligible = chosen.filter(e => canTeachEntry(inst, chair.department, e))
    if (!eligible.length) {
      return res.status(400).json({ message: `${inst.name} can't take these directly — only ${chair.department} instructors (or the shared GE / PATHFIT / NSTP pools for those subjects) can. Use a teaching request for other departments.` })
    }
    const progList = String(inst.programs || '').split(',').map(norm).filter(Boolean)
    if (progList.length && chair.program && !progList.includes(norm(chair.program))) {
      return res.status(400).json({ message: `${inst.name} teaches for ${inst.programs}, not ${chair.program}.` })
    }

    const load = (await getCombinedLoadMap(academic_year, semester))[inst.id] || 0
    const add = eligible.reduce((a, e) => a + creditOf(e), 0)
    const projected = load + add
    if (projected > MAX_UNITS) {
      return res.status(400).json({ message: `${inst.name} is at ${load.toFixed(2)} units; taking ${add.toFixed(2)} more would reach ${projected.toFixed(2)}, over the ${MAX_UNITS}-unit cap. Pick fewer subjects to move.` })
    }

    // Specialty basis: does the instructor teach any of the subjects being handed over?
    const [specRows] = await pool.query(
      `SELECT ps.id AS subject_id, ps.course_code FROM instructor_specialties isp
       JOIN prospectus_subjects ps ON ps.id = isp.subject_id WHERE isp.instructor_id = ?`, [inst.id]
    )
    const matched = eligible.filter(e => specRows.some(sp => sp.subject_id === e.subject_id || norm(sp.course_code) === norm(e.course_code)))
    const exception = projected > TARGET_UNITS || matched.length === 0
    if (exception && (!reason || String(reason).trim().length < 5)) {
      return res.status(400).json({
        needs_reason: true,
        message: `${projected > TARGET_UNITS ? `This puts ${inst.name} at ${projected.toFixed(2)} units (standard load is ${TARGET_UNITS})` : `${inst.name} hasn't picked any of these subjects as a specialty`}. Add a short reason — it's flagged as an exception to the Dean.`,
      })
    }

    // ── do the swap ──
    const ids = eligible.map(e => e.id)
    await pool.query('UPDATE faculty_load_entries SET assigned_instructor_id = ? WHERE id IN (?)', [inst.id, ids])
    await syncConfirmation(req.user.id, academic_year, semester, inst.id)
    const [chg] = await pool.query(
      `INSERT INTO load_changes (chair_id, placeholder_id, instructor_id, academic_year, semester, entry_ids, reason, is_exception)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, ph.id, inst.id, academic_year, semester, JSON.stringify(ids), reason ? String(reason).slice(0, 255) : null, exception ? 1 : 0]
    )
    const changeId = chg.insertId

    // Keep the approved schedule as is, except where the newcomer already teaches at that time.
    let resched = { checked: 0, rescheduled: [], unresolved: [] }
    try {
      resched = await rescheduleConflicts({ academicYear: academic_year, semester: Number(semester), movedEntryIds: ids, instructorId: inst.id })
    } catch (err) {
      console.error('[placeholders] reschedule failed:', err.message)
      resched = { checked: 0, rescheduled: [], unresolved: eligible.map(e => ({ entryId: e.id, courseCode: e.course_code, section: e.program_yr_sec, reason: 'Could not check the schedule automatically.' })) }
    }
    await pool.query('UPDATE load_changes SET rescheduled = ?, unresolved = ? WHERE id = ?', [resched.rescheduled.length, resched.unresolved.length, changeId])

    // ── tell everyone the swap touches ──
    const subjectLines = [...new Set(eligible.map(e => e.course_code))]
    const summary = summarize(eligible)
    const term = `${SEM[semester] || semester} Sem A.Y. ${academic_year}`
    const roleBase = { instructor: 'instructor', chair: 'chair', dean: 'dean' }[inst.role]
    const scheduleNote = resched.rescheduled.length
      ? ` ${resched.rescheduled.length} subject${resched.rescheduled.length > 1 ? 's' : ''} moved to a new time/room to avoid clashing with your existing classes: ${resched.rescheduled.map(r => `${r.courseCode} ${r.section} → ${r.after.join(', ')}`).join('; ')}.`
      : ''
    await notify([inst.id], {
      type: 'load_assigned', refId: changeId, link: `/${roleBase}/my-load`,
      title: `You've been assigned ${subjectLines.length} subject${subjectLines.length > 1 ? 's' : ''} (${eligible.length} section${eligible.length > 1 ? 's' : ''}) by ${req.user.name || 'your chair'}`,
      body: `Taking over from ${ph.name} (${term}): ${summary}. Your load is now ${projected.toFixed(2)} units.${scheduleNote} Please confirm.`,
    })
    const swapBody = `${chair.name} replaced ${ph.name} with ${inst.name} for ${summary} (${term}). Approved subjects, sections and units are unchanged — only the instructor. ${inst.name} is now at ${projected.toFixed(2)} units.${exception && reason ? ` Exception: ${reason}` : ''}${resched.rescheduled.length ? ` ${resched.rescheduled.length} rescheduled.` : ''}${resched.unresolved.length ? ` ${resched.unresolved.length} could not be re-slotted — needs manual scheduling.` : ''}`
    await notify(await deanIds(chair.department), { type: 'load_swap', refId: changeId, title: `${ph.name} replaced by ${inst.name}`, body: swapBody, flag: exception ? 'exception' : null })
    await notify(await adminIds(), {
      type: 'load_swap', refId: changeId, link: '/admin/schedule-generator',
      title: `${ph.name} replaced by ${inst.name}${resched.rescheduled.length || resched.unresolved.length ? ' — schedule changed' : ''}`,
      body: `${swapBody} Reprint the updated Faculty Loading Sheet${resched.rescheduled.length ? ' and republish the schedule' : ''}.`,
      flag: resched.unresolved.length ? 'attention' : (exception ? 'exception' : null),
    })
    if (resched.unresolved.length) {
      await notify([req.user.id], {
        type: 'schedule_attention', refId: changeId, flag: 'attention',
        title: `${resched.unresolved.length} subject${resched.unresolved.length > 1 ? 's' : ''} need a new time slot`,
        body: resched.unresolved.map(u => `${u.courseCode} ${u.section}: ${u.reason}`).join(' • '),
      })
    }
    // Students of the affected sections see who teaches them now, and any new time/room.
    for (const e of eligible) {
      const moved = resched.rescheduled.find(r => r.entryId === e.id)
      const [studs] = await pool.query("SELECT id FROM users WHERE role = 'student' AND UPPER(TRIM(section)) = ?", [norm(e.program_yr_sec)])
      await notify(studs.map(s => s.id), {
        type: 'schedule_update', link: '/student/schedule', refId: e.id,
        title: moved ? `Schedule change: ${e.course_code} ${e.program_yr_sec}` : `New instructor: ${e.course_code} ${e.program_yr_sec}`,
        body: `${e.course_code} — ${e.descriptive_title} is now taught by ${inst.name}.${moved ? ` New schedule: ${moved.after.join(', ')} (was ${moved.before.join(', ')}).` : ' Day, time and room are unchanged.'}`,
      })
    }

    res.json({
      moved: ids.length, load_change_id: changeId, instructor: inst.name, projected_units: projected,
      exception, rescheduled: resched.rescheduled, unresolved: resched.unresolved,
      message: `${inst.name} now teaches ${subjectLines.length} subject${subjectLines.length > 1 ? 's' : ''} from ${ph.name}. They've been asked to confirm; the Dean and Registrar were notified.`,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/placeholders/changes — the swap log ───────────────────────────────
router.get('/changes', authenticate, authorize('chair', 'dean', 'admin'), async (req, res) => {
  try {
    const where = req.user.role === 'chair' ? 'lc.chair_id = ?' : req.user.role === 'dean'
      ? 'c.department = (SELECT department FROM users WHERE id = ?)' : '1 = 1 OR ? IS NULL'
    const [rows] = await pool.query(
      `SELECT lc.*, c.name AS chair_name, c.department AS chair_dept, ph.name AS placeholder_name, i.name AS instructor_name
       FROM load_changes lc JOIN users c ON c.id = lc.chair_id JOIN users ph ON ph.id = lc.placeholder_id JOIN users i ON i.id = lc.instructor_id
       WHERE ${where} ORDER BY lc.id DESC LIMIT 50`, [req.user.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── PATCH /api/placeholders/changes/:id/respond — the new instructor confirms or declines ─
router.patch('/changes/:id/respond', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  const { action } = req.body
  if (!['confirm', 'decline'].includes(action)) return res.status(400).json({ message: 'action must be confirm or decline.' })
  try {
    const [[lc]] = await pool.query(
      `SELECT lc.*, ph.name AS placeholder_name, i.name AS instructor_name, c.department AS chair_dept
       FROM load_changes lc JOIN users ph ON ph.id = lc.placeholder_id JOIN users i ON i.id = lc.instructor_id JOIN users c ON c.id = lc.chair_id
       WHERE lc.id = ? AND lc.instructor_id = ?`, [req.params.id, req.user.id]
    )
    if (!lc) return res.status(404).json({ message: 'Not found.' })
    if (lc.status !== 'pending') return res.status(409).json({ message: `Already ${lc.status}.` })

    if (action === 'confirm') {
      await pool.query("UPDATE load_changes SET status = 'confirmed', confirmed_at = NOW() WHERE id = ?", [lc.id])
      await notify([lc.chair_id], { type: 'load_confirmed', refId: lc.id, title: `${lc.instructor_name} confirmed the load from ${lc.placeholder_name}`, body: 'The swap is complete — nothing further is needed.' })
      return res.json({ message: 'Confirmed. Thank you.' })
    }
    // Declined: hand the subjects back to the placeholder so nothing is left without an instructor.
    const ids = JSON.parse(lc.entry_ids)
    await pool.query('UPDATE faculty_load_entries SET assigned_instructor_id = ? WHERE id IN (?) AND assigned_instructor_id = ?', [lc.placeholder_id, ids, lc.instructor_id])
    await pool.query("UPDATE load_changes SET status = 'declined', confirmed_at = NOW() WHERE id = ?", [lc.id])
    const body = `The subjects are back on ${lc.placeholder_name}. Pick another instructor from Faculty Load.`
    await notify([lc.chair_id], { type: 'load_declined', refId: lc.id, flag: 'attention', title: `${lc.instructor_name} declined the load from ${lc.placeholder_name}`, body })
    await notify(await adminIds(), { type: 'load_declined', refId: lc.id, title: `${lc.placeholder_name} swap declined by ${lc.instructor_name}`, body: `${body} Republish the schedule if it was already updated.` })
    res.json({ message: 'Declined. The subjects went back to the placeholder.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Tell a department's chairs when a newly-specialised instructor matches what a
// placeholder is holding ("Prof X can replace Instructor E"). Called after an
// instructor saves their specialties. Skips a chair who already has the same
// unread hint so repeated saves don't pile up.
export async function notifyPlaceholderMatches(instructorId) {
  try {
    const [[inst]] = await pool.query('SELECT id, name, department FROM users WHERE id = ? AND is_placeholder = 0', [instructorId])
    if (!inst?.department) return
    const [hits] = await pool.query(
      `SELECT DISTINCT ph.id AS placeholder_id, ph.name AS placeholder_name, ph.placeholder_owner AS chair_id, e.course_code, e.descriptive_title
       FROM users ph
       JOIN faculty_load_entries e ON e.assigned_instructor_id = ph.id
       JOIN instructor_specialties isp ON isp.instructor_id = ?
       JOIN prospectus_subjects ps ON ps.id = isp.subject_id
       WHERE ph.is_placeholder = 1 AND ph.department = ?
         AND (ps.id = e.subject_id OR UPPER(TRIM(ps.course_code)) = UPPER(TRIM(e.course_code)))`,
      [inst.id, inst.department]
    )
    const byPlaceholder = new Map()
    for (const h of hits) {
      if (!byPlaceholder.has(h.placeholder_id)) byPlaceholder.set(h.placeholder_id, { ...h, titles: [] })
      byPlaceholder.get(h.placeholder_id).titles.push(h.descriptive_title)
    }
    for (const h of byPlaceholder.values()) {
      const title = `${inst.name} can replace ${h.placeholder_name}`
      const [[dup]] = await pool.query('SELECT id FROM notifications WHERE user_id = ? AND type = ? AND title = ? AND read_at IS NULL', [h.chair_id, 'placeholder_match', title])
      if (dup) continue
      await notify([h.chair_id], {
        type: 'placeholder_match', link: '/chair/faculty-load', refId: h.placeholder_id,
        title, body: `${inst.name}'s specialties include ${[...new Set(h.titles)].join(', ')}, which ${h.placeholder_name} is holding. Open Faculty Load → Placeholders to swap them in.`,
      })
    }
  } catch (err) {
    console.error('[placeholders] match notify failed:', err.message)
  }
}

export default router
