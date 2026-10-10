import { Router } from 'express'
import pool from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { getCombinedLoadMap, MAX_UNITS, syncConfirmation, isGeneralEd } from './facultyload.js'
import { creditOf } from '../utils/unitCredit.js'
import { notify } from '../utils/notify.js'

/**
 * GE Coordinator — General Education has no department of its own; its
 * instructors teach every college's students. Rather than each chair
 * separately drawing from the shared GE pool (risking two colleges
 * independently overloading the same GE instructor on the same day), one
 * coordinator account assigns every college's GE subjects centrally. A chair
 * still adds the GE subject to their own course offering (section, room — only
 * they know their own schedule), just never picks who teaches it; it appears
 * here, unassigned, the moment they save it, and this assignment is what then
 * shows up back on their Faculty Load page.
 */
const router = Router()

// GET /api/ge-coordinator/queue?year=&semester= — every college's unassigned GE subjects
router.get('/queue', authenticate, authorize('ge_coordinator', 'admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [rows] = await pool.query(`
      SELECT fle.*, chairUser.name AS chair_name, chairUser.department AS chair_department
      FROM faculty_load_entries fle
      JOIN users chairUser ON chairUser.id = fle.chair_id
      WHERE fle.academic_year = ? AND fle.semester = ? AND fle.assigned_instructor_id IS NULL
      ORDER BY chairUser.department, fle.program_yr_sec
    `, [year, semester])
    res.json(rows.filter(r => isGeneralEd(r.course_code)))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/ge-coordinator/assigned?year=&semester= — recent GE assignments, for a sanity check across colleges
router.get('/assigned', authenticate, authorize('ge_coordinator', 'admin'), async (req, res) => {
  const { year = '2026-2027', semester = 1 } = req.query
  try {
    const [rows] = await pool.query(`
      SELECT fle.*, chairUser.department AS chair_department, inst.name AS instructor_name
      FROM faculty_load_entries fle
      JOIN users chairUser ON chairUser.id = fle.chair_id
      JOIN users inst ON inst.id = fle.assigned_instructor_id
      WHERE fle.academic_year = ? AND fle.semester = ? AND inst.department = 'General Education'
      ORDER BY fle.id DESC LIMIT 100
    `, [year, semester])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PATCH /api/ge-coordinator/:entryId/assign — pick a GE instructor for one college's subject
router.patch('/:entryId/assign', authenticate, authorize('ge_coordinator', 'admin'), async (req, res) => {
  const { instructor_id } = req.body
  if (!instructor_id) return res.status(400).json({ message: 'Choose an instructor.' })
  try {
    const [[entry]] = await pool.query('SELECT * FROM faculty_load_entries WHERE id = ?', [req.params.entryId])
    if (!entry) return res.status(404).json({ message: 'Entry not found.' })
    if (!isGeneralEd(entry.course_code)) return res.status(400).json({ message: 'That subject is not a GE subject.' })
    if (entry.assigned_instructor_id) return res.status(409).json({ message: 'This subject already has an instructor.' })

    const [[inst]] = await pool.query(
      "SELECT id, name FROM users WHERE id = ? AND department = 'General Education' AND role IN ('instructor','chair','dean') AND is_placeholder = 0",
      [instructor_id]
    )
    if (!inst) return res.status(400).json({ message: 'Pick a General Education instructor.' })

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
