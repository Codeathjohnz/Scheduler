import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { deanOf, chairsOf } from '../utils/deptAccess.js'
import { getCombinedLoadMap, MAX_UNITS, syncConfirmation } from './facultyload.js'
import { creditOf } from '../utils/unitCredit.js'
import { notify } from '../utils/notify.js'

/**
 * Borrowing an instructor from another college, the full chain requested:
 *
 *   Chair A -> Dean A -> Dean B -> Chair B -> Instructor
 *
 * and the instructor's answer climbs back the same way. Nobody skips a link:
 * Chair A never picks the instructor directly (that was the older, simpler
 * flow in crossDept.js/deptAccess.js, left in place but no longer reachable
 * from this UI) — they ask their own Dean, who asks the other college's Dean,
 * who hands it to one of that college's Chairs, who picks a willing
 * instructor from their own department. A decline at the instructor stage
 * only loops back to Chair B (who can simply try someone else) rather than
 * restarting the whole chain — the two Deans already said yes once, and
 * nobody should have to approve the same borrowing twice.
 */
const router = Router()

const STAGE_LABEL = { dean_a: 'Dean A', dean_b: 'Dean B', pending_dean_a: "the requester's Dean", pending_dean_b: "the other college's Dean", pending_chair_b: 'a Program Chair', pending_instructor: 'the instructor' }

const BASE = `
  SELECT c.*,
    fle.course_code, fle.descriptive_title, fle.program_yr_sec, fle.units, fle.lec_hours, fle.lab_hours,
    fle.academic_year, fle.semester,
    reqChair.name AS requested_by_name,
    deanA.name AS dean_a_name,
    deanB.name AS dean_b_name,
    chairB.name AS chair_b_name,
    inst.name AS instructor_name, inst.role AS instructor_role
  FROM cross_dept_chain c
  JOIN faculty_load_entries fle ON fle.id = c.entry_id
  JOIN users reqChair ON reqChair.id = c.requested_by
  LEFT JOIN users deanA ON deanA.id = c.dean_a_id
  LEFT JOIN users deanB ON deanB.id = c.dean_b_id
  LEFT JOIN users chairB ON chairB.id = c.chair_b_id
  LEFT JOIN users inst ON inst.id = c.instructor_id`

async function loadChain(id) {
  const [[r]] = await pool.query(`${BASE} WHERE c.id = ?`, [id])
  return r || null
}
async function log(requestId, event, actorId, note) {
  await pool.query(
    'INSERT INTO cross_dept_chain_log (request_id, event, actor_id, note) VALUES (?, ?, ?, ?)',
    [requestId, event, actorId || null, note ? String(note).slice(0, 255) : null]
  )
}
const label = (r) => `${r.course_code} ${r.program_yr_sec || ''}`.trim()

// POST /api/cross-dept-chain — Chair A asks their own Dean for help with one unassigned subject
router.post('/', authenticate, authorize('chair'), async (req, res) => {
  const { entry_id, target_department, note } = req.body
  if (!entry_id || !target_department) return res.status(400).json({ message: 'Choose a subject and a college to ask.' })
  try {
    const [[entry]] = await pool.query('SELECT * FROM faculty_load_entries WHERE id = ? AND chair_id = ?', [entry_id, req.user.id])
    if (!entry) return res.status(404).json({ message: 'Subject not found.' })
    if (entry.assigned_instructor_id) return res.status(400).json({ message: 'This subject already has an instructor.' })

    const [[me]] = await pool.query('SELECT name, department FROM users WHERE id = ?', [req.user.id])
    if (!me.department) return res.status(400).json({ message: 'Your account has no department set.' })
    if (String(target_department).trim() === me.department) return res.status(400).json({ message: 'That is your own college — no request needed.' })

    const [[open]] = await pool.query(
      `SELECT COUNT(*) AS n FROM cross_dept_chain WHERE entry_id = ? AND stage NOT IN ('finalized','declined','cancelled')`,
      [entry_id]
    )
    if (open.n) return res.status(409).json({ message: 'A request for this subject is already in progress — see Teaching Requests.' })

    const deanA = await deanOf(me.department)
    if (!deanA) return res.status(400).json({ message: `Your college (${me.department}) has no Dean account yet. Ask the Admin to add one first.` })

    const [r] = await pool.query(
      `INSERT INTO cross_dept_chain (entry_id, requested_by, requester_department, target_department, note, dean_a_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry_id, req.user.id, me.department, String(target_department).trim(), note ? String(note).slice(0, 255) : null, deanA.id]
    )
    await log(r.insertId, 'created', req.user.id, note)
    await notify([deanA.id], {
      type: 'cross_dept_chain', link: '/dean/teaching-requests',
      title: `${me.name} needs an instructor from ${target_department} for ${entry.course_code} ${entry.program_yr_sec || ''}`.trim(),
      body: note ? String(note).slice(0, 255) : 'Open Teaching Requests to approve or decline.',
    })
    res.status(201).json({ message: `Sent to your Dean. You'll be notified at every step.`, id: r.insertId })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/cross-dept-chain/mine — Chair A's own requests
router.get('/mine', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [rows] = await pool.query(`${BASE} WHERE c.requested_by = ? ORDER BY c.id DESC LIMIT 100`, [req.user.id])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/cross-dept-chain/dean-inbox — a Dean's two queues: requests from
// their own chairs (as Dean A) and requests from other colleges (as Dean B)
router.get('/dean-inbox', authenticate, authorize('dean'), async (req, res) => {
  try {
    const [[me]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    if (!me?.department) return res.json({ asDeanA: [], asDeanB: [], recent: [] })
    const [asDeanA] = await pool.query(`${BASE} WHERE c.stage = 'pending_dean_a' AND c.requester_department = ? ORDER BY c.id DESC`, [me.department])
    const [asDeanB] = await pool.query(`${BASE} WHERE c.stage = 'pending_dean_b' AND c.target_department = ? ORDER BY c.id DESC`, [me.department])
    const [recent] = await pool.query(
      `${BASE} WHERE (c.requester_department = ? OR c.target_department = ?) AND c.stage NOT IN ('pending_dean_a','pending_dean_b') ORDER BY c.id DESC LIMIT 20`,
      [me.department, me.department]
    )
    res.json({ asDeanA, asDeanB, recent })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PATCH /api/cross-dept-chain/:id/dean-a — Dean A approves (forwards to Dean B) or declines
router.patch('/:id/dean-a', authenticate, authorize('dean'), async (req, res) => {
  const { action, reason } = req.body
  try {
    const r = await loadChain(req.params.id)
    if (!r) return res.status(404).json({ message: 'Request not found.' })
    const [[me]] = await pool.query('SELECT name, department FROM users WHERE id = ?', [req.user.id])
    if (me?.department !== r.requester_department) return res.status(403).json({ message: 'Only the requesting college\'s Dean can decide this.' })
    if (r.stage !== 'pending_dean_a') return res.status(409).json({ message: 'This request is no longer waiting on you.' })

    if (action === 'decline') {
      if (!String(reason || '').trim()) return res.status(400).json({ message: 'Please give a reason for declining.' })
      await pool.query(
        "UPDATE cross_dept_chain SET stage = 'declined', decline_stage = 'dean_a', decline_reason = ?, dean_a_at = NOW() WHERE id = ?",
        [reason.trim(), r.id]
      )
      await log(r.id, 'dean_a_declined', req.user.id, reason)
      await notify([r.requested_by], { type: 'cross_dept_chain', flag: 'attention', link: '/chair/teaching-requests', title: `Your Dean declined the request for ${label(r)}`, body: reason.trim() })
      return res.json({ message: 'Declined.' })
    }

    const deanB = await deanOf(r.target_department)
    if (!deanB) return res.status(400).json({ message: `${r.target_department} has no Dean account yet. Ask the Admin to add one before approving this.` })

    await pool.query("UPDATE cross_dept_chain SET stage = 'pending_dean_b', dean_b_id = ?, dean_a_at = NOW() WHERE id = ?", [deanB.id, r.id])
    await log(r.id, 'dean_a_approved', req.user.id, null)
    await notify([deanB.id], { type: 'cross_dept_chain', link: '/dean/teaching-requests', title: `${r.requester_department} asks to borrow an instructor for ${label(r)}`, body: r.note || `From ${r.requested_by_name}, approved by their Dean.` })
    await notify([r.requested_by], { type: 'cross_dept_chain_result', link: '/chair/teaching-requests', title: `Your Dean approved — now with ${r.target_department}'s Dean`, body: null })
    res.json({ message: `Approved — sent to ${r.target_department}'s Dean.` })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PATCH /api/cross-dept-chain/:id/dean-b — Dean B approves (forwards to that college's Chairs) or declines
router.patch('/:id/dean-b', authenticate, authorize('dean'), async (req, res) => {
  const { action, reason } = req.body
  try {
    const r = await loadChain(req.params.id)
    if (!r) return res.status(404).json({ message: 'Request not found.' })
    const [[me]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    if (me?.department !== r.target_department) return res.status(403).json({ message: `Only ${r.target_department}'s Dean can decide this.` })
    if (r.stage !== 'pending_dean_b') return res.status(409).json({ message: 'This request is no longer waiting on you.' })

    if (action === 'decline') {
      if (!String(reason || '').trim()) return res.status(400).json({ message: 'Please give a reason for declining.' })
      await pool.query(
        "UPDATE cross_dept_chain SET stage = 'declined', decline_stage = 'dean_b', decline_reason = ?, dean_b_at = NOW() WHERE id = ?",
        [reason.trim(), r.id]
      )
      await log(r.id, 'dean_b_declined', req.user.id, reason)
      await notify([r.requested_by], { type: 'cross_dept_chain', flag: 'attention', link: '/chair/teaching-requests', title: `${r.target_department}'s Dean declined your request for ${label(r)}`, body: reason.trim() })
      return res.json({ message: 'Declined.' })
    }

    const chairs = await chairsOf(r.target_department)
    if (!chairs.length) return res.status(400).json({ message: `${r.target_department} has no Program Chair account yet. Ask the Admin to add one before approving this.` })

    await pool.query("UPDATE cross_dept_chain SET stage = 'pending_chair_b', dean_b_at = NOW() WHERE id = ?", [r.id])
    await log(r.id, 'dean_b_approved', req.user.id, null)
    await notify(chairs.map(c => c.id), { type: 'cross_dept_chain', link: '/chair/teaching-requests', title: `${r.requester_department} needs one of your instructors for ${label(r)}`, body: r.note || `Approved by your Dean — pick a willing instructor.` })
    await notify([r.requested_by], { type: 'cross_dept_chain_result', link: '/chair/teaching-requests', title: `${r.target_department}'s Dean approved — now with their Program Chair`, body: null })
    res.json({ message: `Approved — sent to ${r.target_department}'s Program Chair.` })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/cross-dept-chain/to-assign — Chair B's queue: requests waiting for them to pick an instructor
router.get('/to-assign', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [[me]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    if (!me?.department) return res.json([])
    const [rows] = await pool.query(`${BASE} WHERE c.stage = 'pending_chair_b' AND c.target_department = ? ORDER BY c.id DESC`, [me.department])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PATCH /api/cross-dept-chain/:id/assign — Chair B picks (or re-picks, after a decline) a willing instructor
router.patch('/:id/assign', authenticate, authorize('chair'), async (req, res) => {
  const { instructor_id, note } = req.body
  if (!instructor_id) return res.status(400).json({ message: 'Choose an instructor.' })
  try {
    const r = await loadChain(req.params.id)
    if (!r) return res.status(404).json({ message: 'Request not found.' })
    const [[me]] = await pool.query('SELECT name, department FROM users WHERE id = ?', [req.user.id])
    if (me?.department !== r.target_department) return res.status(403).json({ message: `Only a ${r.target_department} Program Chair can assign this.` })
    if (r.stage !== 'pending_chair_b') return res.status(409).json({ message: 'This request is not waiting on you right now.' })

    const [[inst]] = await pool.query(
      "SELECT id, name, department, role FROM users WHERE id = ? AND department = ? AND role IN ('instructor','chair','dean') AND is_placeholder = 0",
      [instructor_id, r.target_department]
    )
    if (!inst) return res.status(400).json({ message: 'Pick an instructor from your own department.' })

    const load = (await getCombinedLoadMap(r.academic_year, r.semester))[inst.id] || 0
    const add = creditOf(r)
    if (load + add > MAX_UNITS) {
      return res.status(400).json({ message: `This would put ${inst.name} at ${(load + add).toFixed(2)} units, over the ${MAX_UNITS}-unit cap. Pick someone else.` })
    }

    await pool.query(
      "UPDATE cross_dept_chain SET stage = 'pending_instructor', chair_b_id = ?, instructor_id = ?, chair_b_at = NOW() WHERE id = ?",
      [req.user.id, inst.id, r.id]
    )
    await log(r.id, 'instructor_asked', req.user.id, note)
    await notify([inst.id], {
      type: 'cross_dept_chain', link: `/${inst.role}/teaching-requests`,
      title: `${me.name} asks you to teach ${label(r)} for ${r.requester_department}`,
      body: note ? String(note).slice(0, 255) : 'Open Teaching Requests to accept or decline.',
    })
    res.json({ message: `Asked ${inst.name}. You'll be notified once they answer.` })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/cross-dept-chain/to-answer — the instructor's own queue
router.get('/to-answer', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  try {
    const [rows] = await pool.query(`${BASE} WHERE c.instructor_id = ? AND c.stage = 'pending_instructor' ORDER BY c.id DESC`, [req.user.id])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PATCH /api/cross-dept-chain/:id/respond — the instructor accepts or declines.
// Decline loops back to Chair B only (try someone else); accept finalizes the
// assignment immediately and notifies every link in the chain on the way back up.
router.patch('/:id/respond', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  const { action, reason } = req.body
  try {
    const r = await loadChain(req.params.id)
    if (!r) return res.status(404).json({ message: 'Request not found.' })
    if (r.instructor_id !== req.user.id) return res.status(403).json({ message: 'This request is not yours to answer.' })
    if (r.stage !== 'pending_instructor') return res.status(409).json({ message: 'This request was already answered or withdrawn.' })

    if (action === 'decline') {
      if (!String(reason || '').trim()) return res.status(400).json({ message: 'Please give a reason for declining.' })
      await pool.query("UPDATE cross_dept_chain SET stage = 'pending_chair_b', instructor_id = NULL, instructor_at = NOW() WHERE id = ?", [r.id])
      await log(r.id, 'instructor_declined', req.user.id, reason)
      if (r.chair_b_id) {
        await notify([r.chair_b_id], { type: 'cross_dept_chain', flag: 'attention', link: '/chair/teaching-requests', title: `${r.instructor_name} declined ${label(r)}`, body: reason.trim() + ' — pick another instructor.' })
      }
      return res.json({ message: 'Declined. Your chair has been notified to pick someone else.' })
    }

    const load = (await getCombinedLoadMap(r.academic_year, r.semester))[req.user.id] || 0
    const add = creditOf(r)
    if (load + add > MAX_UNITS) {
      return res.status(400).json({ message: `Accepting would put you at ${(load + add).toFixed(2)} units, over the ${MAX_UNITS}-unit cap. Decline instead.` })
    }

    await pool.query('UPDATE faculty_load_entries SET assigned_instructor_id = ? WHERE id = ?', [req.user.id, r.entry_id])
    await pool.query("UPDATE cross_dept_chain SET stage = 'finalized', instructor_at = NOW() WHERE id = ?", [r.id])
    await log(r.id, 'instructor_accepted', req.user.id, null)
    await syncConfirmation(r.requested_by, r.academic_year, r.semester, req.user.id)

    const recipients = [r.chair_b_id, r.dean_b_id, r.dean_a_id].filter(Boolean)
    if (recipients.length) {
      await notify(recipients, { type: 'cross_dept_chain_result', title: `${r.instructor_name} accepted to teach ${label(r)} for ${r.requester_department}`, body: 'Finalized — forwarded up the chain.' })
    }
    await notify([r.requested_by], { type: 'cross_dept_chain_result', link: '/chair/faculty-load', title: `Finalized — ${r.instructor_name} will teach ${label(r)}`, body: 'It now appears in your Faculty Load.' })

    res.json({ message: 'Accepted — this is now part of your load.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /api/cross-dept-chain/:id — Chair A withdraws a request that's still open
router.delete('/:id', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE cross_dept_chain SET stage = 'cancelled' WHERE id = ? AND requested_by = ? AND stage NOT IN ('finalized','declined','cancelled')",
      [req.params.id, req.user.id]
    )
    if (!result.affectedRows) return res.status(404).json({ message: 'No open request to withdraw.' })
    await log(req.params.id, 'cancelled', req.user.id, null)
    res.json({ message: 'Request withdrawn.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/cross-dept-chain/:id — full detail with its event log, for anyone involved
router.get('/:id', authenticate, async (req, res) => {
  try {
    const r = await loadChain(req.params.id)
    if (!r) return res.status(404).json({ message: 'Request not found.' })
    const involved = [r.requested_by, r.dean_a_id, r.dean_b_id, r.chair_b_id, r.instructor_id]
    if (req.user.role !== 'admin' && !involved.includes(req.user.id)) return res.status(403).json({ message: 'Access denied.' })
    const [events] = await pool.query(
      `SELECT l.*, u.name AS actor_name FROM cross_dept_chain_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.request_id = ? ORDER BY l.id`,
      [r.id]
    )
    res.json({ ...r, events })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/cross-dept-chain/counts — small numbers for nav badges. A chair or
// dean can be waiting on more than one role at once (e.g. a chair who is also
// the instructor someone else picked), so these add up rather than branch.
router.get('/counts', authenticate, async (req, res) => {
  try {
    let n = 0
    const [[me]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    if (req.user.role === 'dean' && me?.department) {
      const [[c]] = await pool.query(
        `SELECT COUNT(*) AS n FROM cross_dept_chain
         WHERE (stage = 'pending_dean_a' AND requester_department = ?) OR (stage = 'pending_dean_b' AND target_department = ?)`,
        [me.department, me.department]
      )
      n += c.n
    }
    if (req.user.role === 'chair' && me?.department) {
      const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM cross_dept_chain WHERE stage = 'pending_chair_b' AND target_department = ?`, [me.department])
      n += c.n
    }
    if (['instructor', 'chair', 'dean'].includes(req.user.role)) {
      const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM cross_dept_chain WHERE instructor_id = ? AND stage = 'pending_instructor'`, [req.user.id])
      n += c.n
    }
    res.json({ pending: n })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
