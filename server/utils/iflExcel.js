/**
 * Individual Faculty Load (IFL) as an Excel workbook, laid out like the
 * institution's own sheet: a half-hour timetable on the left (A:G) and the
 * summary of load on the right (I:M), with the sign-off block underneath.
 *
 * One sheet per instructor, so a whole department can be printed from one file.
 */
import { creditOf } from './unitCredit.js'
import ExcelJS from 'exceljs'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_COL = { Monday: 2, Tuesday: 3, Wednesday: 4, Thursday: 5, Friday: 6, Saturday: 7 }   // B..G
const SLOT_MIN = 30
const GRID_START = 7 * 60          // 07:00
const GRID_SLOTS = 24              // 07:00 .. 19:00
const GRID_FIRST_ROW = 12
const AMBER = 'FFFFC000'
const GREY = 'FFF2F2F2'

const SEM_NAME = { 1: 'First Semester', 2: 'Second Semester', 3: 'Summer' }
const COLLEGE = {
  CCIS: 'COLLEGE OF COMPUTING AND INFORMATION SCIENCES',
  CTE: 'COLLEGE OF TEACHER EDUCATION',
}

const toMin = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m }
const credit = (lec, lab) => Number(lec || 0) + Number(lab || 0) * 0.75

const box = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
function put(ws, addr, value, { bold = false, center = false, fill = null, border = false, wrap = false, size = 10 } = {}) {
  const c = ws.getCell(addr)
  c.value = value ?? null
  c.font = { name: 'Arial', size, bold }
  c.alignment = { horizontal: center ? 'center' : 'left', vertical: 'middle', wrapText: wrap }
  if (border) c.border = box
  if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
  return c
}

/**
 * @param {object} p
 * @param {{name, department, role}} p.instructor
 * @param {number} p.semester
 * @param {string} p.year             e.g. "2026-2027"
 * @param {Array}  p.sessions         [{ days, start_time, end_time, session_type, course_code, program_yr_sec, room }]
 * @param {Array}  p.entries          [{ course_code, descriptive_title, program_yr_sec, units, lec_hours, lab_hours }]
 * @param {Array}  p.adminLoads       [{ load_type, description, units, hours }]
 * @param {{dean, registrar, vpaa}} p.signatories  names from the users table
 */
export async function buildIflWorkbook({ instructor, semester, year, sessions, entries, adminLoads, signatories }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ADSSU Room Scheduling System'
  const ws = wb.addWorksheet(String(instructor.name || 'IFL').slice(0, 31))

  ws.columns = [
    { width: 16 }, { width: 10.7 }, { width: 10.7 }, { width: 10.7 }, { width: 10.7 },
    { width: 10.7 }, { width: 10.7 }, { width: 3.7 }, { width: 60.9 }, { width: 11 },
    { width: 11 }, { width: 13 }, { width: 13 },
  ]
  const college = COLLEGE[String(instructor.department || '').toUpperCase()] || String(instructor.department || '').toUpperCase()

  // Header block
  const title = [
    ['AGUSAN DEL SUR STATE COLLEGE OF AGRICULTURE AND TECHNOLOGY', { bold: true, center: true, size: 11 }],
    [college, { bold: true, center: true }],
    ['Bunawan, Agusan del Sur', { center: true }],
    ['INDIVIDUAL FACULTY LOAD', { bold: true, center: true, size: 11 }],
    [`${SEM_NAME[semester] || `Semester ${semester}`} A.Y ${year}`, { center: true }],
  ]
  title.forEach(([text, opt], i) => {
    const row = i + 1
    ws.mergeCells(`A${row}:M${row}`)
    put(ws, `A${row}`, text, opt)
  })
  ws.mergeCells('A7:M7')
  put(ws, 'A7', `NAME OF FACULTY: ${String(instructor.name || '').toUpperCase()}`, { bold: true })

  // Section titles
  ws.mergeCells('A9:G9'); put(ws, 'A9', 'SCHEDULE OF CLASSES', { bold: true, center: true })
  ws.mergeCells('I9:M9'); put(ws, 'I9', 'SUMMARY OF LOAD', { bold: true, center: true })

  // Timetable header row
  put(ws, 'A11', 'TIME', { bold: true, center: true, border: true, fill: GREY })
  DAYS.forEach(d => {
    const col = String.fromCharCode(64 + DAY_COL[d])
    put(ws, `${col}11`, d.slice(0, 3).toUpperCase(), { bold: true, center: true, border: true, fill: GREY })
  })
  put(ws, 'I11', '', { border: false })
  ;['Academic Load', 'Unit Credit', 'Contact Hours', 'No. of Student'].forEach((h, i) => {
    put(ws, `${'JKLM'[i]}11`, h, { bold: true, center: true, border: true, fill: GREY, wrap: true })
  })

  // Timetable body: a labelled half-hour row for every slot, sessions written into their first slot
  const grid = {}   // "row|col" -> [text]
  for (const s of sessions) {
    const col = DAY_COL[s.days]
    if (!col) continue
    const start = toMin(s.start_time), end = toMin(s.end_time)
    const first = Math.floor((start - GRID_START) / SLOT_MIN)
    const last = Math.ceil((end - GRID_START) / SLOT_MIN)
    if (first < 0 || first >= GRID_SLOTS) continue
    const room = s.room && s.room.trim() ? s.room.trim() : 'ONLINE CLASS'
    const text = `${s.course_code} (${String(s.session_type).toUpperCase() === 'LAB' ? 'LAB' : 'LEC'}) - (${s.program_yr_sec || '—'}) ${room}`
    const key = `${GRID_FIRST_ROW + first}|${col}`
    ;(grid[key] ||= []).push(text)
    for (let k = first + 1; k < Math.min(last, GRID_SLOTS); k++) grid[`${GRID_FIRST_ROW + k}|${col}`] ||= []
  }
  for (let i = 0; i < GRID_SLOTS; i++) {
    const row = GRID_FIRST_ROW + i
    const t = GRID_START + i * SLOT_MIN
    const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    put(ws, `A${row}`, `${hh(t)}-${hh(t + SLOT_MIN)}`, { bold: true, border: true, size: 9 })
    for (const d of DAYS) {
      const col = DAY_COL[d]
      const L = String.fromCharCode(64 + col)
      const items = grid[`${row}|${col}`]
      put(ws, `${L}${row}`, items && items.length ? items.join('\n') : null, { border: true, wrap: true, size: 8 })
    }
  }

  // Summary of load (right-hand side)
  let r = GRID_FIRST_ROW
  const line = (label, { units = null, credit: cr = null, contact = null, students = null, fill = null, bold = false } = {}) => {
    put(ws, `I${r}`, label, { border: true, fill, bold, wrap: true })
    put(ws, `J${r}`, units, { border: true, center: true, bold })
    put(ws, `K${r}`, cr, { border: true, center: true, bold })
    put(ws, `L${r}`, contact, { border: true, center: true, bold })
    put(ws, `M${r}`, students, { border: true, center: true, bold })
    r++
  }

  line('A. Academic Load', { bold: true })
  let acU = 0, acC = 0, acH = 0
  for (const e of entries) {
    const u = Number(e.units || 0), cr = creditOf(e), h = Number(e.lec_hours || 0) + Number(e.lab_hours || 0)
    acU += u; acC += cr; acH += h
    line(`${e.course_code} ${e.descriptive_title || ''} ${e.program_yr_sec || ''}`.trim(), { units: u, credit: cr, contact: h, fill: AMBER })
  }
  line('Total Academic Load', { units: acU, credit: acC, contact: acH, bold: true })

  const sections = { administrative: [], research: [], extension: [], project: [], consultation: [], lesson_prep: [] }
  for (const a of adminLoads) (sections[a.load_type] ||= []).push(a)
  const admin = sections.administrative
  line('B. Administrative Load', { bold: true })
  let adU = 0, adH = 0
  for (const a of admin) { adU += Number(a.units || 0); adH += Number(a.hours || 0); line(a.description, { units: Number(a.units || 0), credit: Number(a.units || 0), contact: Number(a.hours || 0), fill: AMBER }) }
  line('Total Administrative Load', { units: adU, credit: adU, contact: adH, bold: true })

  const project = [...sections.research, ...sections.extension, ...sections.project]
  line('C. Project', { bold: true })
  let prU = 0, prH = 0
  for (const a of project) { prU += Number(a.units || 0); prH += Number(a.hours || 0); line(`${a.load_type[0].toUpperCase()}${a.load_type.slice(1)}: ${a.description}`, { units: Number(a.units || 0), credit: Number(a.units || 0), contact: Number(a.hours || 0), fill: AMBER }) }
  line('Total Project', { units: prU, credit: prU, contact: prH, bold: true })

  const others = [...sections.consultation, ...sections.lesson_prep]
  line('D. Others', { bold: true })
  let otU = 0, otH = 0
  for (const a of others) { otU += Number(a.units || 0); otH += Number(a.hours || 0); line(a.load_type === 'lesson_prep' ? `Lesson Preparation: ${a.description}` : `Consultation: ${a.description}`, { units: Number(a.units || 0), credit: Number(a.units || 0), contact: Number(a.hours || 0), fill: AMBER }) }
  line('Total Others', { units: otU, credit: otU, contact: otH, bold: true })

  const grandU = acU + adU + prU + otU, grandC = acC + adU + prU + otU, grandH = acH + adH + prH + otH
  line('Total', { units: grandU, credit: grandC, contact: grandH, bold: true })

  // Sign-off block, below both halves: name on one line, title under it.
  const sign = Math.max(r, GRID_FIRST_ROW + GRID_SLOTS) + 2
  put(ws, `A${sign}`, 'Jointly Prepared by:')
  put(ws, `I${sign}`, 'Conforme:')
  put(ws, `J${sign}`, 'Approved:')
  put(ws, `A${sign + 1}`, signatories.dean || '', { bold: true })
  put(ws, `A${sign + 2}`, `Dean, ${college}`)
  put(ws, `D${sign + 1}`, signatories.registrar || '', { bold: true })
  put(ws, `D${sign + 2}`, 'College Registrar')
  put(ws, `I${sign + 1}`, instructor.name || '', { bold: true })
  put(ws, `I${sign + 2}`, 'Faculty')
  put(ws, `J${sign + 1}`, signatories.vpaa || '', { bold: true })
  put(ws, `J${sign + 2}`, 'Vice President for Academic Affairs and Quality Assurance')

  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
  return wb
}
