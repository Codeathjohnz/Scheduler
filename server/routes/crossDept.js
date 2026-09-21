import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { getCombinedLoadMap, MAX_UNITS, TARGET_UNITS, syncConfirmation } from './facultyload.js'

/**
 * Teaching for another department.
 *
 * A chair can't just assign an instructor from a different department (that
 * person has their own students). They send a request, and the subject stays
 * UNASSIGNED — so it counts toward nobody's load and stays out of the schedule
 * — until BOTH:
 *   1. the instructor accepts (status pending_instructor -> pending_home), and
 *   2. their home department's chair/dean approves (pending_home -> approved).
 * Only on that final approval is the entry assigned to them, which is the
 * moment it starts counting toward their load. The unit cap is checked when
 * the request is made, when the instructor accepts, and again at final
 * approval (other assignments may have landed in between), so an accepted
 * request can never push someone past the hard cap.
 */
const router = Router()

const credit = (lec, lab) => Number(lec || 0) + Number(lab || 0) * 0.75

const BASE = `
  SELECT r.*,
    fle.course_code, fle.descriptive_title, fle.program_yr_sec, fle.units, fle.lec_hours, fle.lab_hours,
    fle.academic_year, fle.semester, fle.chair_id AS entry_chair_id, fle.assigned_instructor_id AS entry_assigned,
    i.name AS instructor_name, i.department AS instructor_dept, i.role AS instructor_role,
    c.name AS chair_name, c.department AS chair_dept
  FROM cross_dept_requests r
  JOIN faculty_load_entries fle ON fle.id = r.entry_id
  JOIN users i ON i.id = r.instructor_id
  JOIN users c ON c.id = r.requested_by`

// Adds the instructor's current load and what it would become, so both the
// instructor and their home approver can see the effect before saying yes.
async function withLoad(rows) {
  const maps = new Map()
  const out = []
  for (const r of rows) {
    const key = `${r.academic_year}|${r.semester}`
    if (!maps.has(key)) maps.set(key, await getCombinedLoadMap(r.academic_year, r.semester))
    const current = maps.get(key)[r.instructor_id] || 0
    const add = credit(r.lec_hours, r.lab_hours)
    out.push({ ...r, current_units: current, unit_credit: add, projected_units: current + add, target_units: TARGET_UNITS, max_units: MAX_UNITS })
  }
  return out
}

async function loadRequest(id) {
  const [[r]] = await pool.query(`${BASE} WHERE r.id = ?`, [id])
  return r || null
}

// Who can sign off for an instructor's home department: chairs and deans of
// that department, never the instructor themselves. A chair who is teaching
// out needs their dean; a dean has no one above them in the system.
function homeApproverRoles(instructorRole) {
  if (instructorRole === 'dean') return []
  if (instructorRole === 'chair') return ['dean']
  return ['chair', 'dean']
}

async function homeApproverExists(r) {
  const roles = homeApproverRoles(r.instructor_role)
  if (!roles.length) return false
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS n FROM users WHERE department = ? AND id <> ? AND role IN (?)',
    [r.instructor_dept, r.instructor_id, roles]
  )
  return row.n > 0
}

// The step that makes it real: cap check, assign the entry, pull the
// instructor into the chair's confirmation set. Returns an error string or null.
async function finalize(r, homeApproverId) {
  if (r.entry_assigned) {
    await pool.query("UPDATE cross_dept_requests SET status = 'cancelled' WHERE id = ?", [r.id])
    return 'This subject was already assigned to someone else, so the request was closed.'
  }
  const load = (await getCombinedLoadMap(r.academic_year, r.semester))[r.instructor_id] || 0
  const add = credit(r.lec_hours, r.lab_hours)
  if (load + add > MAX_UNITS) {
    return `This would put ${r.instructor_name} at ${(load + add).toFixed(2)} units, over the ${MAX_UNITS}-unit cap.`
  }
  await pool.query('UPDATE faculty_load_entries SET assigned_instructor_id = ? WHERE id = ?', [r.instructor_id, r.entry_id])
  await pool.query(
    "UPDATE cross_dept_requests SET status = 'approved', home_approver_id = ?, home_action_at = NOW() WHERE id = ?",
    [homeApproverId || null, r.id]
  )
  await syncConfirmation(r.entry_chair_id, r.academic_year, r.semester, r.instructor_id)
  return null
}

// GET /api/cross-dept/mine — requests asking ME to teach for another department
router.get('/mine', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  try {
    const [rows] = await pool.query(`${BASE} WHERE r.instructor_id = ? AND r.status <> 'cancelled' ORDER BY r.id DESC LIMIT 100`, [req.user.id])
    res.json(await withLoad(rows))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PATCH /api/cross-dept/:id/respond — the instructor accepts or declines
router.patch('/:id/respond', authenticate, authorize('instructor', 'chair', 'dean'), async (req, res) => {
  const { action, reason } = req.body
  if (!['accept', 'decline'].includes(action)) return res.status(400).json({ message: 'action must be accept or decline.' })
  try {
    const r = await loadRequest(req.params.id)
    if (!r || r.instructor_id !== req.user.id) return res.status(404).json({ message: 'Request not found.' })
    if (r.status !== 'pending_instructor') return res.status(409).json({ message: 'This request was already answered or withdrawn.' })
    if (r.entry_assigned) {
      await pool.query("UPDATE cross_dept_requests SET status = 'cancelled' WHERE id = ?", [r.id])
      return res.status(409).json({ message: 'This subject was already assigned to someone else.' })
    }

    if (action === 'decline') {
      await pool.query(
        "UPDATE cross_dept_requests SET status = 'declined', declined_stage = 'instructor', decline_reason = ?, instructor_action_at = NOW() WHERE id = ?",
        [reason ? String(reason).slice(0, 255) : null, r.id]
      )
      return res.json({ message: 'Declined. The requesting chair has been notified on their page.' })
    }

    const load = (await getCombinedLoadMap(r.academic_year, r.semester))[req.user.id] || 0
    const add = credit(r.lec_hours, r.lab_hours)
    if (load + add > MAX_UNITS) {
      return res.status(400).json({ message: `Accepting would put you at ${(load + add).toFixed(2)} units, over the ${MAX_UNITS}-unit cap. Decline, or free up load first.` })
    }

    if (await homeApproverExists(r)) {
      await pool.query("UPDATE cross_dept_requests SET status = 'pending_home', instructor_action_at = NOW() WHERE id = ?", [r.id])
      return res.json({ message: `Accepted. It now goes to your department (${r.instructor_dept}) for approval before it's added to your load.` })
    }
    // Nobody in the home department could sign off, so the instructor's own yes is enough.
    await pool.query("UPDATE cross_dept_requests SET instructor_action_at = NOW() WHERE id = ?", [r.id])
    const err = await finalize(r, null)
    if (err) return res.status(400).json({ message: err })
    res.json({ message: 'Accepted — the subject is now part of your load.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/cross-dept/home — requests waiting on MY department's approval
router.get('/home', authenticate, authorize('chair', 'dean'), async (req, res) => {
  try {
    const [me] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    const dept = me[0]?.department
    if (!dept) return res.json({ pending: [], recent: [] })
    const eligible = (r) => homeApproverRoles(r.instructor_role).includes(req.user.role)
    const [pending] = await pool.query(
      `${BASE} WHERE r.status = 'pending_home' AND i.department = ? AND r.instructor_id <> ? ORDER BY r.id DESC`, [dept, req.user.id]
    )
    const [recent] = await pool.query(
      `${BASE} WHERE r.status IN ('approved', 'declined') AND r.home_action_at IS NOT NULL AND i.department = ? ORDER BY r.home_action_at DESC LIMIT 20`, [dept]
    )
    res.json({ pending: await withLoad(pending.filter(eligible)), recent })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PATCH /api/cross-dept/:id/home — the instructor's home chair/dean approves or declines
router.patch('/:id/home', authenticate, authorize('chair', 'dean'), async (req, res) => {
  const { action, reason } = req.body
  if (!['approve', 'decline'].includes(action)) return res.status(400).json({ message: 'action must be approve or decline.' })
  try {
    const r = await loadRequest(req.params.id)
    if (!r) return res.status(404).json({ message: 'Request not found.' })
    const [me] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    if (me[0]?.department !== r.instructor_dept || r.instructor_id === req.user.id || !homeApproverRoles(r.instructor_role).includes(req.user.role)) {
      return res.status(403).json({ message: `Only the ${r.instructor_dept} department can approve this.` })
    }
    if (r.status !== 'pending_home') return res.status(409).json({ message: 'This request is no longer waiting on approval.' })

    if (action === 'decline') {
      await pool.query(
        "UPDATE cross_dept_requests SET status = 'declined', declined_stage = 'home', decline_reason = ?, home_approver_id = ?, home_action_at = NOW() WHERE id = ?",
        [reason ? String(reason).slice(0, 255) : null, req.user.id, r.id]
      )
      return res.json({ message: 'Declined.' })
    }
    const err = await finalize(r, req.user.id)
    if (err) return res.status(400).json({ message: err })
    res.json({ message: `Approved — ${r.instructor_name} now teaches ${r.course_code} ${r.program_yr_sec} and it counts toward their load.` })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/cross-dept/sent — requests I (a chair) have sent to other departments
router.get('/sent', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [rows] = await pool.query(`${BASE} WHERE r.requested_by = ? AND r.status <> 'cancelled' ORDER BY r.id DESC LIMIT 100`, [req.user.id])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /api/cross-dept/:id — the requesting chair withdraws a request that's still open
router.delete('/:id', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE cross_dept_requests SET status = 'cancelled' WHERE id = ? AND requested_by = ? AND status IN ('pending_instructor', 'pending_home')",
      [req.params.id, req.user.id]
    )
    if (!result.affectedRows) return res.status(404).json({ message: 'No open request to withdraw.' })
    res.json({ message: 'Request withdrawn.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/cross-dept/counts — small numbers for nav badges
router.get('/counts', authenticate, async (req, res) => {
  try {
    const [[incoming]] = await pool.query("SELECT COUNT(*) AS n FROM cross_dept_requests WHERE instructor_id = ? AND status = 'pending_instructor'", [req.user.id])
    let approvals = 0
    if (['chair', 'dean'].includes(req.user.role)) {
      const [me] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
      if (me[0]?.department) {
        const [rows] = await pool.query(
          `SELECT i.role AS instructor_role FROM cross_dept_requests r JOIN users i ON i.id = r.instructor_id
           WHERE r.status = 'pending_home' AND i.department = ? AND r.instructor_id <> ?`, [me[0].department, req.user.id]
        )
        approvals = rows.filter(r => homeApproverRoles(r.instructor_role).includes(req.user.role)).length
      }
    }
    res.json({ incoming: incoming.n, approvals })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
