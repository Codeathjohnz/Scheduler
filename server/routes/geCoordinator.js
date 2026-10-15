import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { getCombinedLoadMap, MAX_UNITS, syncConfirmation, coordinatorPool } from './facultyload.js'
import { creditOf } from '../utils/unitCredit.js'
import { notify } from '../utils/notify.js'

/**
 * GE Coordinator — GE and PATHFIT have no department of their own; their
 * instructors teach every college's students. Rather than each chair
 * separately drawing from a shared pool (risking two colleges independently
 * overloading the same GE or PATHFIT instructor on the same day), one
 * coordinator account assigns every college's GE and PATHFIT subjects
 * centrally.
 *
 * Same concept as borrowing from another college, minus the Dean-to-Dean
 * hop — there's only one recipient, so it's one step: a chair adds the
 * subject to their own course offering (section, room — only they know
 * their own schedule), then sends an explicit request for it (PATCH
 * /request). Only requested subjects ever reach the Coordinator's queue;
 * saving it unassigned alone isn't enough, same as it isn't for the
 * cross-department chain. The assignment that follows is what then shows up
 * back on the chair's Faculty Load page.
 */
const router = Router()

// GET /api/ge-coordinator/queue?year=&semester= — every college's requested, still-unassigned GE/PATHFIT subjects
router.get('/queue', authenticate, authorize('ge_coordinator', 'admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [rows] = await pool.query(`
      SELECT fle.*, chairUser.name AS chair_name, chairUser.department AS chair_department,
        p.program AS subject_program
      FROM faculty_load_entries fle
      JOIN users chairUser ON chairUser.id = fle.chair_id
      LEFT JOIN prospectus_subjects ps ON ps.id = fle.subject_id
      LEFT JOIN prospectus p ON p.id = ps.prospectus_id
      WHERE fle.academic_year = ? AND fle.semester = ? AND fle.assigned_instructor_id IS NULL
        AND fle.ge_requested_at IS NOT NULL
      ORDER BY fle.ge_requested_at, chairUser.department, fle.program_yr_sec
    `, [year, semester])
    res.json(rows.filter(r => coordinatorPool(r.course_code)).map(r => ({ ...r, pool: coordinatorPool(r.course_code) })))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PATCH /api/ge-coordinator/request — a chair asks the GE Coordinator for one
// or more subjects at once (e.g. 3 sections nobody in the department can
// cover). Nothing here picks an instructor — it just puts the subject in
// front of the Coordinator, same as the first step of the cross-department
// chain puts a request in front of a Dean.
router.patch('/request', authenticate, authorize('chair'), async (req, res) => {
  const { entry_ids } = req.body
  if (!Array.isArray(entry_ids) || !entry_ids.length) {
    return res.status(400).json({ message: 'entry_ids is required.' })
  }
  try {
    const [rows] = await pool.query(
      `SELECT id, course_code, program_yr_sec FROM faculty_load_entries
       WHERE id IN (?) AND chair_id = ? AND assigned_instructor_id IS NULL AND ge_requested_at IS NULL`,
      [entry_ids, req.user.id]
    )
    const eligible = rows.filter(r => coordinatorPool(r.course_code))
    if (!eligible.length) {
      return res.status(400).json({ message: 'Nothing eligible to request — already requested, already assigned, or not a GE/PATHFIT subject.' })
    }
    const ids = eligible.map(r => r.id)
    await pool.query('UPDATE faculty_load_entries SET ge_requested_at = NOW() WHERE id IN (?)', [ids])

    const [coordinators] = await pool.query("SELECT id FROM users WHERE role = 'ge_coordinator'")
    const [[me]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.user.id])
    await notify(coordinators.map(c => c.id), {
      type: 'ge_requested', link: '/ge-coordinator',
      title: `${me.name} needs ${ids.length > 1 ? `${ids.length} instructors` : 'an instructor'} (${eligible.map(r => r.course_code).join(', ')})`,
      body: eligible.map(r => `${r.course_code} ${r.program_yr_sec || ''}`.trim()).join('; '),
    })
    res.json({ message: `Requested ${ids.length} subject${ids.length > 1 ? 's' : ''} — the GE Coordinator has been notified.`, requested: ids.length })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/ge-coordinator/mine — a chair's own GE/PATHFIT requests still
// waiting on the Coordinator to assign, across every term.
router.get('/mine', authenticate, authorize('chair'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM faculty_load_entries
       WHERE chair_id = ? AND assigned_instructor_id IS NULL AND ge_requested_at IS NOT NULL
       ORDER BY academic_year DESC, semester, id`,
      [req.user.id]
    )
    res.json(rows.filter(r => coordinatorPool(r.course_code)).map(r => ({ ...r, pool: coordinatorPool(r.course_code) })))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/ge-coordinator/assigned?year=&semester= — recent assignments, for a sanity check across colleges
router.get('/assigned', authenticate, authorize('ge_coordinator', 'admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [rows] = await pool.query(`
      SELECT fle.*, chairUser.department AS chair_department, inst.name AS instructor_name
      FROM faculty_load_entries fle
      JOIN users chairUser ON chairUser.id = fle.chair_id
      JOIN users inst ON inst.id = fle.assigned_instructor_id
      WHERE fle.academic_year = ? AND fle.semester = ? AND inst.department IN ('General Education', 'PATHFIT')
      ORDER BY fle.id DESC LIMIT 100
    `, [year, semester])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PATCH /api/ge-coordinator/:entryId/assign — pick a GE or PATHFIT instructor for one college's subject
router.patch('/:entryId/assign', authenticate, authorize('ge_coordinator', 'admin'), async (req, res) => {
  const { instructor_id } = req.body
  if (!instructor_id) return res.status(400).json({ message: 'Choose an instructor.' })
  try {
    const [[entry]] = await pool.query('SELECT * FROM faculty_load_entries WHERE id = ?', [req.params.entryId])
    if (!entry) return res.status(404).json({ message: 'Entry not found.' })
    const poolName = coordinatorPool(entry.course_code)
    if (!poolName) return res.status(400).json({ message: 'That subject is not a GE or PATHFIT subject.' })
    if (entry.assigned_instructor_id) return res.status(409).json({ message: 'This subject already has an instructor.' })

    const [[inst]] = await pool.query(
      "SELECT id, name FROM users WHERE id = ? AND department = ? AND role IN ('instructor','chair','dean') AND is_placeholder = 0",
      [instructor_id, poolName]
    )
    if (!inst) return res.status(400).json({ message: `Pick a ${poolName} instructor.` })

    const load = (await getCombinedLoadMap(entry.academic_year, entry.semester))[inst.id] || 0
    const add = creditOf(entry)
    if (load + add > MAX_UNITS) {
      return res.status(400).json({ message: `This would put ${inst.name} at ${(load + add).toFixed(2)} units, over the ${MAX_UNITS}-unit cap. Pick someone else.` })
    }

    await pool.query('UPDATE faculty_load_entries SET assigned_instructor_id = ? WHERE id = ?', [inst.id, entry.id])
    await syncConfirmation(entry.chair_id, entry.academic_year, entry.semester, inst.id)
    await notify([entry.chair_id], {
      type: 'ge_assigned', link: '/chair/faculty-load',
      title: `${inst.name} will teach ${entry.course_code} (${entry.program_yr_sec || 'your section'})`,
      body: 'Assigned by the GE Coordinator.',
    })
    res.json({ message: `${inst.name} assigned.` })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
