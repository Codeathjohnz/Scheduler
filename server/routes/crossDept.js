import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { getCombinedLoadMap, MAX_UNITS, TARGET_UNITS, syncConfirmation } from './facultyload.js'
import { notify } from '../utils/notify.js'
import { hasDeptGrant, departmentApprovers } from '../utils/deptAccess.js'

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
    const dept_approved = await hasDeptGrant(r.requested_by, r.instructor_dept, r.academic_year, r.semester)
    out.push({ ...r, dept_approved, current_units: current, unit_credit: add, projected_units: current + add, target_units: TARGET_UNITS, max_units: MAX_UNITS })
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

async function homeApproverIds(r) {
  const roles = homeApproverRoles(r.instructor_role)
  if (!roles.length) return []
  const [rows] = await pool.query('SELECT id FROM users WHERE department = ? AND id <> ? AND role IN (?)', [r.instructor_dept, r.instructor_id, roles])
  return rows.map(x => x.id)
}
const label = (r) => `${r.course_code} ${r.program_yr_sec}`

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
  await notify([r.requested_by], { type: 'teaching_request_result', link: '/chair/faculty-load', title: `${r.instructor_name} will teach ${label(r)}`, body: 'Approved by both sides — it is now assigned and counts toward their load.' })
  await notify([r.instructor_id], { type: 'teaching_request_result', link: `/${r.instructor_role}/my-load`, title: `${label(r)} for ${r.chair_dept} is now part of your load`, body: 'Approved by your department. It appears under My Faculty Load.' })
  return null
}

// ── Department access: the chair asks the OTHER college's Dean first ─────────
// Nothing about a specific instructor happens until the Dean says yes; after
// that the chair can pick a willing instructor from that college.

const accessBase = `
  SELECT a.*, u.name AS requester_name, u.department AS requester_dept, d.name AS decided_by_name
  FROM dept_access_requests a
  JOIN users u ON u.id = a.requester_id
  LEFT JOIN users d ON d.id = a.decided_by`

// GET /api/cross-dept/access/departments?year=&semester= — colleges I can ask, with my status for the term
router.get('/access/departments', authenticate, authorize('chair'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [[me]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    const [depts] = await pool.query(
      `SELECT DISTINCT department FROM users
       WHERE department IS NOT NULL AND department <> ? AND is_placeholder = 0
         AND role IN ('instructor','chair','dean') AND department NOT IN ('General Education','PATHFIT','NSTP')
       ORDER BY department`, [me?.department || '']
    )
    const [mine] = await pool.query(
      "SELECT target_department, status FROM dept_access_requests WHERE requester_id = ? AND academic_year = ? AND semester = ? AND status IN ('pending','approved')",
      [req.user.id, year, semester]
    )
    const status = new Map(mine.map(m => [m.target_department, m.status]))
    const out = []
    for (const d of depts) {
      const approvers = await departmentApprovers(d.department)
      out.push({ department: d.department, status: status.get(d.department) || null, has_approver: approvers.length > 0 })
    }
    res.json(out)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// POST /api/cross-dept/access — ask a college's Dean for instructor access this term
router.post('/access', authenticate, authorize('chair'), async (req, res) => {
  const { target_department, academic_year, semester, note } = req.body
  if (!target_department || !academic_year || !semester) return res.status(400).json({ message: 'Choose a college, academic year and semester.' })
  try {
    const [[me]] = await pool.query('SELECT name, department FROM users WHERE id = ?', [req.user.id])
    if (target_department === me?.department) return res.status(400).json({ message: 'That is your own department — no request needed.' })
    const [[exists]] = await pool.query(
      "SELECT COUNT(*) AS n FROM users WHERE department = ? AND is_placeholder = 0 AND role IN ('instructor','chair','dean')", [target_department]
    )
    if (!exists.n) return res.status(400).json({ message: 'No such college or department.' })
    const approvers = await departmentApprovers(target_department)
    if (!approvers.length) return res.status(400).json({ message: `${target_department} has no Dean or Chair account to approve this yet.` })
    const [[open]] = await pool.query(
      "SELECT COUNT(*) AS n FROM dept_access_requests WHERE requester_id = ? AND target_department = ? AND academic_year = ? AND semester = ? AND status IN ('pending','approved')",
      [req.user.id, target_department, academic_year, semester]
    )
    if (open.n) return res.status(409).json({ message: 'You already have a pending or approved request for that college this term.' })

    await pool.query(
      'INSERT INTO dept_access_requests (requester_id, target_department, academic_year, semester, note) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, target_department, academic_year, semester, note ? String(note).slice(0, 255) : null]
    )
    await notify(approvers.map(a => a.id), {
      type: 'dept_access_request', link: `/${approvers[0].role}/teaching-requests`,
      title: `${me.name} (${me.department}) asks to borrow instructors from ${target_department}`,
      body: note ? String(note).slice(0, 255) : 'Open Teaching Requests to approve or decline.',
    })
    res.status(201).json({ message: `Request sent to the ${target_department} Dean. You can pick their instructors once it's approved.` })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// GET /api/cross-dept/access/sent — my requests
router.get('/access/sent', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [rows] = await pool.query(`${accessBase} WHERE a.requester_id = ? AND a.status <> 'cancelled' ORDER BY a.id DESC LIMIT 50`, [req.user.id])
    res.json(rows)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// Deans decide for their department; a department with no dean falls back to its chair.
async function canDecide(userId, role, department) {
  if (!['dean', 'chair'].includes(role) || !department) return false
  const approvers = await departmentApprovers(department)
  return approvers.some(a => a.id === userId)
}

// GET /api/cross-dept/access/incoming — requests for MY department
router.get('/access/incoming', authenticate, authorize('chair', 'dean'), async (req, res) => {
  try {
    const [[me]] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
    if (!(await canDecide(req.user.id, req.user.role, me?.department))) return res.json({ pending: [], recent: [] })
    const [pending] = await pool.query(`${accessBase} WHERE a.target_department = ? AND a.status = 'pending' ORDER BY a.id DESC`, [me.department])
    const [recent] = await pool.query(`${accessBase} WHERE a.target_department = ? AND a.status IN ('approved','declined') ORDER BY a.decided_at DESC LIMIT 10`, [me.department])
    res.json({ pending, recent })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// PATCH /api/cross-dept/access/:id — the Dean approves or declines
router.patch('/access/:id', authenticate, authorize('chair', 'dean'), async (req, res) => {
  const { action, reason } = req.body
  if (!['approve', 'decline'].includes(action)) return res.status(400).json({ message: 'action must be approve or decline.' })
  try {
    const [[a]] = await pool.query(`${accessBase} WHERE a.id = ?`, [req.params.id])
    if (!a) return res.status(404).json({ message: 'Request not found.' })
    if (!(await canDecide(req.user.id, req.user.role, a.target_department))) return res.status(403).json({ message: `Only the ${a.target_department} Dean can decide this.` })
    if (a.status !== 'pending') return res.status(409).json({ message: 'This request was already answered or withdrawn.' })
    const approve = action === 'approve'
    await pool.query(
      'UPDATE dept_access_requests SET status = ?, decided_by = ?, decline_reason = ?, decided_at = NOW() WHERE id = ?',
      [approve ? 'approved' : 'declined', req.user.id, approve ? null : (reason ? String(reason).slice(0, 255) : null), a.id]
    )
    await notify([a.requester_id], approve
      ? { type: 'dept_access_result', link: '/chair/faculty-load', title: `${a.target_department} approved your request`, body: 'You can now pick their instructors under “Other departments” in Faculty Load. Each instructor still has to accept.' }
      : { type: 'dept_access_result', flag: 'attention', link: '/chair/teaching-requests', title: `${a.target_department} declined your request`, body: reason ? String(reason).slice(0, 255) : 'No reason given.' })
    res.json({ message: approve ? `Approved — ${a.requester_name} can now pick ${a.target_department} instructors.` : 'Declined.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// DELETE /api/cross-dept/access/:id — withdraw a request that's still pending
router.delete('/access/:id', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [r] = await pool.query("UPDATE dept_access_requests SET status = 'cancelled' WHERE id = ? AND requester_id = ? AND status = 'pending'", [req.params.id, req.user.id])
    if (!r.affectedRows) return res.status(404).json({ message: 'No pending request to withdraw.' })
    res.json({ message: 'Request withdrawn.' })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

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
      await notify([r.requested_by], { type: 'teaching_request_result', flag: 'attention', link: '/chair/teaching-requests', title: `${r.instructor_name} declined ${label(r)}`, body: reason ? String(reason).slice(0, 255) : 'No reason given. Pick another instructor from Faculty Load.' })
      return res.json({ message: 'Declined. The requesting chair has been notified on their page.' })
    }

    const load = (await getCombinedLoadMap(r.academic_year, r.semester))[req.user.id] || 0
    const add = credit(r.lec_hours, r.lab_hours)
    if (load + add > MAX_UNITS) {
      return res.status(400).json({ message: `Accepting would put you at ${(load + add).toFixed(2)} units, over the ${MAX_UNITS}-unit cap. Decline, or free up load first.` })
    }

    // The Dean already approved this chair's access to the department, so the
    // instructor's own yes is the last step - no second approval.
    const deanCleared = await hasDeptGrant(r.requested_by, r.instructor_dept, r.academic_year, r.semester)
    if (!deanCleared && await homeApproverExists(r)) {
      await pool.query("UPDATE cross_dept_requests SET status = 'pending_home', instructor_action_at = NOW() WHERE id = ?", [r.id])
      const dashBase = (role) => `/${role}/teaching-requests`
      const approvers = await pool.query('SELECT id, role FROM users WHERE id IN (?)', [await homeApproverIds(r)]).then(([rows]) => rows).catch(() => [])
      for (const a of approvers) {
        await notify([a.id], { type: 'teaching_request_approval', link: dashBase(a.role), title: `${r.instructor_name} accepted to teach ${label(r)} for ${r.chair_dept}`, body: 'It needs your department\'s approval before it counts toward their load.' })
      }
      await notify([r.requested_by], { type: 'teaching_request_result', link: '/chair/teaching-requests', title: `${r.instructor_name} accepted ${label(r)}`, body: `Now waiting for ${r.instructor_dept} to approve.` })
      return res.json({ message: `Accepted. It now goes to your department (${r.instructor_dept}) for approval before it's added to your load.` })
    }
    // Dean-cleared, or nobody in the home department could sign off: the instructor's own yes is enough.
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
      await notify([r.requested_by], { type: 'teaching_request_result', flag: 'attention', link: '/chair/teaching-requests', title: `${r.instructor_dept} declined ${r.instructor_name} for ${label(r)}`, body: reason ? String(reason).slice(0, 255) : 'No reason given. Pick another instructor from Faculty Load.' })
      await notify([r.instructor_id], { type: 'teaching_request_result', link: `/${r.instructor_role}/teaching-requests`, title: `Your department declined ${label(r)} for ${r.chair_dept}`, body: reason ? String(reason).slice(0, 255) : null })
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
    let access = 0
    if (['chair', 'dean'].includes(req.user.role)) {
      const [me] = await pool.query('SELECT department FROM users WHERE id = ?', [req.user.id])
      if (await canDecide(req.user.id, req.user.role, me[0]?.department)) {
        const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM dept_access_requests WHERE target_department = ? AND status = 'pending'", [me[0].department])
        access = n.n
      }
    }
    res.json({ incoming: incoming.n, approvals, access })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
