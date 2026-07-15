import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import pool from '../config/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'faculty-loading-template.docx')

// Same formula used everywhere else in this codebase (facultyload.js,
// client/src/pages/chair/FacultyLoad.jsx): Contact Hours = Lec + Lab,
// Unit Credit = Lec + Lab×0.75 — confirmed against the real Faculty Loading
// form and the official Prospectus's own Lec/Lab/Units figures.
function contactHours(lec, lab) {
  return Number(lec || 0) + Number(lab || 0)
}
function unitCredit(lec, lab) {
  return Number(lec || 0) + Number(lab || 0) * 0.75
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// docxtemplater needs '' (not 0) for a section total when that section has
// zero entries, matching the original form's blank-when-empty convention.
function fmtTotal(n, hasEntries) {
  return hasEntries ? round2(n) : ''
}

export async function generateFacultyLoadingDocx({ chairId, academicYear, semester, collegeName, programName }) {
  const [chairRows] = await pool.query('SELECT name, department FROM users WHERE id = ?', [chairId])
  const chair = chairRows[0]
  if (!chair) throw new Error('Chair not found.')

  const [entries] = await pool.query(`
    SELECT fle.*, u.id AS instructor_id, u.name AS instructor_name
    FROM faculty_load_entries fle
    JOIN users u ON fle.assigned_instructor_id = u.id
    WHERE fle.chair_id = ? AND fle.academic_year = ? AND fle.semester = ?
    ORDER BY u.name, fle.sort_order, fle.id
  `, [chairId, academicYear, semester])

  const [adminLoadRows] = await pool.query(`
    SELECT fal.*, u.name AS instructor_name
    FROM faculty_admin_loads fal
    JOIN users u ON fal.instructor_id = u.id
    WHERE fal.chair_id = ? AND fal.academic_year = ? AND fal.semester = ?
  `, [chairId, academicYear, semester])

  // Group by instructor — only instructors with at least one teaching entry
  // or admin/research load appear in the report.
  const byInstructor = new Map()
  const order = []
  function ensure(id, name) {
    if (!byInstructor.has(id)) {
      byInstructor.set(id, { name, courses: [], adminLoads: [], researchLoads: [] })
      order.push(id)
    }
    return byInstructor.get(id)
  }

  for (const e of entries) {
    const inst = ensure(e.instructor_id, e.instructor_name)
    inst.courses.push({
      courseNo: e.course_code,
      title: e.descriptive_title,
      program: e.program_yr_sec || '',
      units: e.units,
      lec: e.lec_hours,
      lab: e.lab_hours,
      unitCredit: round2(unitCredit(e.lec_hours, e.lab_hours)),
      contactHours: contactHours(e.lec_hours, e.lab_hours),
      labRoom: e.room || '',
    })
  }

  for (const a of adminLoadRows) {
    const inst = ensure(a.instructor_id, a.instructor_name)
    const row = {
      desc: a.description,
      units: a.units,
      lec: a.lec_hours || 0,
      lab: a.lab_hours || 0,
      unitCredit: round2(unitCredit(a.lec_hours, a.lab_hours) || Number(a.units)),
      contactHours: contactHours(a.lec_hours, a.lab_hours) || Number(a.units),
    }
    if (a.load_type === 'administrative') inst.adminLoads.push(row)
    else inst.researchLoads.push(row)
  }

  const instructors = order.map(id => {
    const inst = byInstructor.get(id)

    const sum = (list, key) => list.reduce((acc, r) => acc + Number(r[key] || 0), 0)

    const totalUnits        = sum(inst.courses, 'units')
    const totalLec           = sum(inst.courses, 'lec')
    const totalLab           = sum(inst.courses, 'lab')
    const totalUnitCredit    = round2(sum(inst.courses, 'unitCredit'))
    const totalContactHours  = sum(inst.courses, 'contactHours')

    const hasAdmin = inst.adminLoads.length > 0
    const totalAdminUnits       = sum(inst.adminLoads, 'units')
    const totalAdminLec         = sum(inst.adminLoads, 'lec')
    const totalAdminLab         = sum(inst.adminLoads, 'lab')
    const totalAdminUnitCredit  = round2(sum(inst.adminLoads, 'unitCredit'))
    const totalAdminContactHours = sum(inst.adminLoads, 'contactHours')

    const hasResearch = inst.researchLoads.length > 0
    const totalResearchUnits       = sum(inst.researchLoads, 'units')
    const totalResearchLec         = sum(inst.researchLoads, 'lec')
    const totalResearchLab         = sum(inst.researchLoads, 'lab')
    const totalResearchUnitCredit  = round2(sum(inst.researchLoads, 'unitCredit'))
    const totalResearchContactHours = sum(inst.researchLoads, 'contactHours')

    return {
      collegeName: collegeName || chair.department || '',
      programName: programName || '',
      semester: ['', '1st', '2nd', 'Summer'][semester] || String(semester),
      academicYear,
      name: inst.name,
      courses: inst.courses.map(c => ({
        ...c,
        unitCredit: c.unitCredit.toFixed(2).replace(/\.00$/, ''),
      })),
      totalUnits, totalLec, totalLab,
      totalUnitCredit: totalUnitCredit.toFixed(2).replace(/\.00$/, ''),
      totalContactHours,
      adminLoads: inst.adminLoads.map(r => ({
        adminDesc: r.desc, adminUnits: r.units, adminLec: r.lec, adminLab: r.lab,
        adminUnitCredit: r.unitCredit, adminContactHours: r.contactHours,
      })),
      totalAdminUnits: fmtTotal(totalAdminUnits, hasAdmin),
      totalAdminLec: fmtTotal(totalAdminLec, hasAdmin),
      totalAdminLab: fmtTotal(totalAdminLab, hasAdmin),
      totalAdminUnitCredit: fmtTotal(totalAdminUnitCredit, hasAdmin),
      totalAdminContactHours: fmtTotal(totalAdminContactHours, hasAdmin),
      researchLoads: inst.researchLoads.map(r => ({
        researchDesc: r.desc, researchUnits: r.units, researchLec: r.lec, researchLab: r.lab,
        researchUnitCredit: r.unitCredit, researchContactHours: r.contactHours,
      })),
      totalResearchUnits: fmtTotal(totalResearchUnits, hasResearch),
      totalResearchLec: fmtTotal(totalResearchLec, hasResearch),
      totalResearchLab: fmtTotal(totalResearchLab, hasResearch),
      totalResearchUnitCredit: fmtTotal(totalResearchUnitCredit, hasResearch),
      totalResearchContactHours: fmtTotal(totalResearchContactHours, hasResearch),
      grandTotalUnits: totalUnits + totalAdminUnits + totalResearchUnits,
      grandTotalLec: totalLec + totalAdminLec + totalResearchLec,
      grandTotalLab: totalLab + totalAdminLab + totalResearchLab,
      grandTotalUnitCredit: round2(totalUnitCredit + totalAdminUnitCredit + totalResearchUnitCredit).toFixed(2).replace(/\.00$/, ''),
      grandTotalContactHours: totalContactHours + totalAdminContactHours + totalResearchContactHours,
    }
  })

  if (instructors.length === 0) {
    throw new Error('No faculty load entries with an assigned instructor found for this term.')
  }

  const templateBuf = fs.readFileSync(TEMPLATE_PATH)
  const zip = new PizZip(templateBuf)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })

  doc.render({ chairName: chair.name, instructors })

  return doc.getZip().generate({ type: 'nodebuffer' })
}
