/**
 * Department access grants.
 *
 * Before a chair can pick an instructor from another college, the Dean of that
 * college has to approve a dept_access_requests row for that chair, department,
 * academic year and semester. Once approved, the chair may pick any willing
 * instructor from that department; the instructor still has to accept, but the
 * dean's approval stands in for the per-subject home-department sign-off, so
 * nobody has to approve the same thing twice.
 */
import pool from '../config/db.js'

export async function hasDeptGrant(chairId, department, year, semester) {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS n FROM dept_access_requests WHERE requester_id = ? AND target_department = ? AND academic_year = ? AND semester = ? AND status = 'approved'",
    [chairId, department, year, semester]
  )
  return row.n > 0
}

// Departments this chair may currently draw instructors from.
export async function grantedDepartments(chairId, year, semester) {
  const [rows] = await pool.query(
    "SELECT DISTINCT target_department FROM dept_access_requests WHERE requester_id = ? AND academic_year = ? AND semester = ? AND status = 'approved'",
    [chairId, year, semester]
  )
  return new Set(rows.map(r => r.target_department))
}

// Who signs off for a department: its dean(s); if it has none, its chair(s).
export async function departmentApprovers(department) {
  const [deans] = await pool.query("SELECT id, role FROM users WHERE department = ? AND role = 'dean' AND is_placeholder = 0", [department])
  if (deans.length) return deans
  const [chairs] = await pool.query("SELECT id, role FROM users WHERE department = ? AND role = 'chair' AND is_placeholder = 0", [department])
  return chairs
}

// The Dean-to-Dean borrowing chain needs one specific Dean per department,
// not the department/chair fallback above — a department with no Dean yet
// simply can't be asked, and the chair is told so plainly.
export async function deanOf(department) {
  const [[dean]] = await pool.query(
    "SELECT id, name FROM users WHERE department = ? AND role = 'dean' AND is_placeholder = 0 ORDER BY id LIMIT 1",
    [department]
  )
  return dean || null
}

// Every chair of a department — a department with more than one program
// (CCIS has BSIT and BSIS) has more than one, and any of them may pick up
// an incoming request on behalf of their college.
export async function chairsOf(department) {
  const [rows] = await pool.query(
    "SELECT id, name FROM users WHERE department = ? AND role = 'chair' AND is_placeholder = 0",
    [department]
  )
  return rows
}
