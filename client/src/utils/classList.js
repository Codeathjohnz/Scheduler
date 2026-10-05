import * as XLSX from 'xlsx'

/**
 * Reads the registrar's class-list spreadsheets (one per section) into students.
 *
 * Each file names its section ("Course & Year: BSIS-1A") and lists its students
 * in a table under a STUDENT ID header. Only numbered rows are students; the
 * MALE/FEMALE sub-headings and the footer are skipped.
 */
export function parseClassList(rows) {
  const headerAt = rows.findIndex(r => String(r[1] || '').trim().toUpperCase() === 'STUDENT ID')
  if (headerAt < 0) return { section: '', students: [], error: 'No STUDENT ID header found. Is this a class list?' }
  const sectionRow = rows.find(r => String(r[1] || '').trim().toLowerCase().startsWith('course & year'))
  const section = String(sectionRow?.[2] || '').trim()

  const students = []
  for (const r of rows.slice(headerAt + 1)) {
    if (typeof r[0] !== 'number') continue          // only numbered student rows
    const studentId = String(r[1] || '').trim()
    if (!studentId) continue
    students.push({
      student_id: studentId,
      last_name: String(r[2] || '').trim(),
      first_name: String(r[3] || '').trim(),
      middle_name: String(r[4] || '').trim(),
      remarks: String(r[5] || '').trim().toUpperCase(),
      email: String(r[7] || '').trim().toLowerCase(),
    })
  }
  return { section, students }
}

/** Reads one .xlsx file (ArrayBuffer) into its section and students. */
export function readClassListFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  return parseClassList(rows)
}

// Year level from a section like "BSIS-2A" -> 2.
const yearOf = (section) => {
  const m = /-(\d)/.exec(section || '')
  return m ? Number(m[1]) : 99
}

/**
 * Combines every file into one list, one row per student.
 * - A student listed in several sections gets their HOME section: the lowest
 *   year level (someone taking a 3rd-year subject is still a 2nd-year student).
 * - A student whose every row is DROPPED isn't enrolled, so is left out.
 */
export function combineClassLists(files) {
  const byId = new Map()
  for (const f of files) {
    for (const s of f.students) {
      const cur = byId.get(s.student_id) || { ...s, sections: [], remarks: [] }
      if (f.section && !cur.sections.includes(f.section)) cur.sections.push(f.section)
      cur.remarks.push(s.remarks)
      if (!cur.email && s.email) cur.email = s.email
      byId.set(s.student_id, cur)
    }
  }
  let dropped = 0
  const students = []
  for (const s of byId.values()) {
    if (s.remarks.every(r => r === 'DROPPED')) { dropped++; continue }
    const home = [...s.sections].sort((a, b) => yearOf(a) - yearOf(b))[0] || ''
    students.push({ ...s, section: home, in_sections: s.sections })
  }
  return { students, dropped, duplicates: files.reduce((n, f) => n + f.students.length, 0) - byId.size }
}

export const isInstitutionalEmail = (email) => /^[a-z0-9._-]+@adssu\.edu\.ph$/.test(String(email || ''))

/**
 * The institutional account record: one sheet per program, each with an
 * "Email" and a "Year & Section" column (no names). Returns null when the
 * workbook is a class list instead.
 */
export function readAccountRecord(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const isRecord = wb.SheetNames.some(n => {
    const first = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })[0] || []
    return String(first[0]).trim().toLowerCase() === 'email' && String(first[1]).trim().toLowerCase().startsWith('year')
  })
  if (!isRecord) return null

  const records = []
  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' }).slice(1)
    for (const r of rows) {
      const email = String(r[0] || '').trim().toLowerCase()
      const sec = String(r[1] || '').trim().toUpperCase()
      if (!email && !sec) continue
      records.push({ email, sec, sheet })
    }
  }
  return records
}

// Sheet name -> the program as the system writes it ("BSEd-SCIECE" -> "BSED-SCIENCE").
export function programFromSheet(sheet) {
  return String(sheet || '').trim().toUpperCase().replace('SCIECE', 'SCIENCE')
}

// Program key used for matching (ignores case and punctuation).
export const programKeyOf = (name) => String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Year from a section like "3C" -> 3.
const yearOfSec = (sec) => { const m = /^(\d)/.exec(sec || ''); return m ? Number(m[1]) : 99 }

/**
 * Turns the account-record rows into students, one per email, in their home
 * section (the lowest year level listed for them). Each one carries the
 * department of the Program Chair tagged for their program, or is marked
 * unresolved when no chair has that program yet.
 */
export function buildRecordStudents(records, users) {
  const deptByKey = new Map()
  for (const u of users) {
    if (u.role !== 'chair' || !u.department) continue
    for (const tag of String(u.programs || '').split(',')) {
      const k = programKeyOf(tag)
      if (k && !deptByKey.has(k)) deptByKey.set(k, u.department.trim())
    }
  }
  const byEmail = new Map()
  for (const r of records) {
    const cur = byEmail.get(r.email)
    if (!cur || yearOfSec(r.sec) < yearOfSec(cur.sec)) byEmail.set(r.email, r)
  }
  return [...byEmail.values()].map(r => {
    const program = programFromSheet(r.sheet)
    const dept = deptByKey.get(programKeyOf(program)) || null
    const username = r.email.split('@')[0]
    return {
      student_id: username, name: username, last_name: '', first_name: '', middle_name: '',
      email: r.email, section: `${program} ${r.sec}`, program, department: dept,
      unresolved: !dept, in_sections: [], remarks: [],
    }
  })
}
