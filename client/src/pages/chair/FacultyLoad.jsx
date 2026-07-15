import { useState, useEffect, useRef, Fragment } from 'react'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import { prospectusAPI, facultyLoadAPI, submissionsAPI, schedulingAPI } from '../../services/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import {
  Upload, FileSpreadsheet, Trash2, ChevronDown, ChevronUp,
  Loader2, BookOpen, CheckCircle2, X, Plus, Printer,
  GraduationCap, Users, Edit2, Send, Clock, CheckCircle, Layers, DoorOpen
} from 'lucide-react'

/* ─── helpers ──────────────────────────────────────────────── */
const SEM_LABEL  = { 1: '1st', 2: '2nd', 3: 'Summer' }
const YEAR_LABEL = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' }
const YEAR_COLORS = {
  1: 'bg-blue-50 border-blue-200 text-blue-800',
  2: 'bg-green-50 border-green-200 text-green-800',
  3: 'bg-amber-50 border-amber-200 text-amber-800',
  4: 'bg-purple-50 border-purple-200 text-purple-800',
}

// Non-teaching load categories, submitted by instructors and approved by the
// chair on the Load Requests page. Administrative/Research/Extension/Project
// each carry a title + flat unit credit (no lec/lab breakdown); Consultation
// and Lesson Preparation are hours-only (no title, no unit credit) and never
// count toward the 21/27 unit-credit cap.
const LOAD_TYPES = [
  { key: 'administrative', label: 'Administrative Load' },
  { key: 'research',       label: 'Research Load' },
  { key: 'extension',      label: 'Extension Load' },
  { key: 'project',        label: 'Project Load' },
  { key: 'consultation',   label: 'Consultation', hoursOnly: true },
  { key: 'lesson_prep',    label: 'Lesson Preparation', hoursOnly: true },
]
const LOAD_TYPE_LABEL = Object.fromEntries(LOAD_TYPES.map(t => [t.key, t.label]))
const HOURS_ONLY_TYPES = new Set(LOAD_TYPES.filter(t => t.hoursOnly).map(t => t.key))

// Must match the server's auto-generate cap (server/routes/facultyload.js)
const TARGET_UNITS = 21
const MAX_UNITS = 27
// Must match the server's Contact Hrs cap (server/routes/loadRequests.js)
const CONTACT_HRS_MAX = 40

function unitCredit(lec, lab) { return Number(lec) + Number(lab) * 0.75 }
function contactHours(lec, lab) { return Number(lec) + Number(lab) }

// Table headers ("Course No.", "Descriptive Title", ...) repeat at the top of every
// year-level/semester block in the source spreadsheet — recognize and skip them
// instead of importing them as bogus zero-unit subjects.
const HEADER_LABELS = new Set(['course no', 'course no.', 'course code', 'code', 'subject code', 'subject'])

function parseProspectus(rows) {
  const subjects = []; let yearLevel = 1; let semester = 1
  const semMap = { FIRST: 1, SECOND: 2, THIRD: 3, SUMMER: 3 }
  for (const row of rows) {
    const c2 = String(row[2] || '').trim(); const c3 = String(row[3] || '').trim()
    const match = c2.match(/^(\d+)(?:ST|ND|RD|TH)\s+YEAR\s*[-–]\s*(\w+)\s+SEMESTER/i)
    if (match) { yearLevel = parseInt(match[1]); semester = semMap[match[2].toUpperCase()] || 1; continue }
    if (!c2 || !c3 || c2 === 'Grade' || !/[A-Za-z]/.test(c2)) continue
    if (HEADER_LABELS.has(c2.toLowerCase()) || c3.toLowerCase() === 'descriptive title') continue
    const units = parseFloat(row[4])
    if (isNaN(units)) continue   // real subject rows always have a numeric unit value
    subjects.push({
      course_code: c2, descriptive_title: c3,
      units, lec_hours: parseFloat(row[6]) || 0,
      lab_hours: parseFloat(row[7]) || 0, year_level: yearLevel, semester,
      prerequisite: String(row[8]||'').trim().toLowerCase() !== 'none' ? String(row[8]||'').trim() : null,
    })
  }
  return subjects
}

function groupSubjects(subjects) {
  const g = {}
  for (const s of subjects) {
    const k = `${s.year_level}-${s.semester}`
    if (!g[k]) g[k] = { year_level: s.year_level, semester: s.semester, subjects: [] }
    g[k].subjects.push(s)
  }
  return Object.values(g).sort((a,b) => a.year_level !== b.year_level ? a.year_level-b.year_level : a.semester-b.semester)
}

/* ─── PRINT VIEW ────────────────────────────────────────────── */
function PrintView({ entries, adminLoads, year, semester, onClose }) {
  // Group entries by instructor
  const instructorMap = {}
  for (const e of entries) {
    const key = e.assigned_instructor_id || '__unassigned__'
    const name = e.instructor_name || '— Unassigned —'
    if (!instructorMap[key]) instructorMap[key] = { name, dept: e.instructor_dept, subjects: [] }
    instructorMap[key].subjects.push(e)
  }
  const instructors = Object.values(instructorMap)

  const semLabel = { 1: '1st', 2: '2nd', 3: 'Summer' }[semester]

  const handlePrint = () => window.print()

  const [downloadingDocx, setDownloadingDocx] = useState(false)
  const handleDownloadDocx = async () => {
    const collegeName = window.prompt('College full name (as it should appear on the form):', 'COLLEGE OF COMPUTING AND INFORMATION SCIENCE')
    if (collegeName === null) return
    const programName = window.prompt('Program full name (as it should appear on the form):', 'BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY')
    if (programName === null) return
    setDownloadingDocx(true)
    try {
      const res = await facultyLoadAPI.exportDocx(year, semester, collegeName, programName)
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `FacultyLoading_${year}_Sem${semester}.docx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      toast.success('Faculty Loading downloaded.')
    } catch (err) {
      const isBlob = err.response?.data instanceof Blob
      const message = isBlob ? JSON.parse(await err.response.data.text()).message : err.response?.data?.message
      toast.error(message || 'Download failed.')
    } finally {
      setDownloadingDocx(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-auto">
      {/* Screen-only toolbar */}
      <div className="print:hidden sticky top-0 bg-green-800 text-white flex items-center gap-4 px-6 py-3 shadow z-10">
        <button onClick={onClose} className="flex items-center gap-2 hover:text-amber-400 transition text-sm">
          <X className="w-4 h-4" /> Close Preview
        </button>
        <span className="text-green-300 text-sm">|</span>
        <span className="text-sm font-semibold">Faculty Loading Sheet — AY {year} {semLabel} Semester</span>
        <button onClick={handleDownloadDocx} disabled={downloadingDocx}
          className="ml-auto flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold px-4 py-1.5 rounded-lg transition text-sm">
          {downloadingDocx ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          Download DOCX
        </button>
        <button onClick={handlePrint}
          className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-green-900 font-bold px-4 py-1.5 rounded-lg transition text-sm">
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      {/* One block per instructor */}
      <div className="p-6 print:p-0">
        {instructors.map((inst, idx) => {
          const subs = inst.subjects
          const totalUnits   = subs.reduce((a,s) => a + Number(s.units), 0)
          const totalLec     = subs.reduce((a,s) => a + Number(s.lec_hours), 0)
          const totalLab     = subs.reduce((a,s) => a + Number(s.lab_hours), 0)
          const totalCredit  = subs.reduce((a,s) => a + unitCredit(s.lec_hours,s.lab_hours), 0)
          const totalContact = subs.reduce((a,s) => a + contactHours(s.lec_hours,s.lab_hours), 0)

          // Non-teaching loads for this instructor — administrative, research,
          // extension, project. These are flat unit credits with no lec/lab hours.
          const instId = subs[0]?.assigned_instructor_id
          const instructorLoads = adminLoads.filter(a => a.instructor_id === instId)
          const loadSections = LOAD_TYPES.map(lt => {
            const rows  = instructorLoads.filter(a => (a.load_type || 'administrative') === lt.key)
            const total = rows.reduce((a,r) => a + Number(r.units), 0)
            return { ...lt, rows, total }
          })
          const totalOtherLoads = loadSections.reduce((a,s) => a + s.total, 0)
          // Consultation/Lesson Prep are hours-only — they never count toward Unit
          // Credit, but they are real weekly hours, so they roll into Contact Hrs.
          const totalHoursOnly = instructorLoads
            .filter(a => HOURS_ONLY_TYPES.has(a.load_type))
            .reduce((a,r) => a + Number(r.hours || 0), 0)

          const grandUnits   = totalUnits   + totalOtherLoads
          const grandLec     = totalLec
          const grandLab     = totalLab
          const grandCredit  = totalCredit  + totalOtherLoads
          const grandContact = totalContact + totalHoursOnly

          return (
            <div key={idx} className="mb-8 print:mb-0 print:page-break-after-always">
              <style>{`@media print { .instructor-block { page-break-after: always; } }`}</style>
              <div className="instructor-block border border-gray-400 print:border-black" style={{fontFamily:'Arial,sans-serif',fontSize:'10pt'}}>
                {/* College header */}
                <div style={{textAlign:'center',padding:'8px 12px',borderBottom:'1px solid #999'}}>
                  <div style={{fontWeight:'bold',fontSize:'11pt'}}>COLLEGE OF COMPUTING AND INFORMATION SCIENCE</div>
                  <div style={{fontWeight:'bold'}}>BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY</div>
                  <div style={{marginTop:'4px'}}>
                    Semester: <strong>{semLabel}</strong>&nbsp;&nbsp;&nbsp;Academic Year: <strong>{year}</strong>
                  </div>
                </div>

                {/* Table */}
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'9pt'}}>
                  <thead>
                    <tr style={{background:'#f5f5f5'}}>
                      <th style={th} rowSpan={2}>Name of Instructor<br/>(LN, FN, MI)</th>
                      <th style={th} rowSpan={2}>Course No.</th>
                      <th style={th} rowSpan={2}>Descriptive Title</th>
                      <th style={th} rowSpan={2}>Program/<br/>Yr/Sec</th>
                      <th style={th} rowSpan={2}>No. of<br/>Units</th>
                      <th style={{...th,textAlign:'center'}} colSpan={2}>No. of Hour/Week</th>
                      <th style={th} rowSpan={2}>Unit<br/>Credit</th>
                      <th style={th} rowSpan={2}>Contact<br/>Hours</th>
                      <th style={th} rowSpan={2}>Lab Room<br/>to be used</th>
                    </tr>
                    <tr style={{background:'#f5f5f5'}}>
                      <th style={th}>Lec</th>
                      <th style={th}>Lab</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Academic Load rows */}
                    {subs.map((s, si) => (
                      <tr key={s.id}>
                        <td style={{...td, fontWeight: si===0?'bold':'normal'}}>
                          {si === 0 ? inst.name.toUpperCase() : ''}
                        </td>
                        <td style={td}>{s.course_code}</td>
                        <td style={td}>{s.descriptive_title}</td>
                        <td style={{...td,textAlign:'center'}}>{s.program_yr_sec}</td>
                        <td style={{...td,textAlign:'center'}}>{s.units}</td>
                        <td style={{...td,textAlign:'center'}}>{s.lec_hours}</td>
                        <td style={{...td,textAlign:'center'}}>{s.lab_hours}</td>
                        <td style={{...td,textAlign:'center'}}>{unitCredit(s.lec_hours,s.lab_hours).toFixed(2)}</td>
                        <td style={{...td,textAlign:'center'}}>{contactHours(s.lec_hours,s.lab_hours)}</td>
                        <td style={td}>{s.room || ''}</td>
                      </tr>
                    ))}
                    {/* Academic totals */}
                    <tr style={{background:'#f0f0f0',fontWeight:'bold'}}>
                      <td style={{...td}} colSpan={4}>Total Academic Load</td>
                      <td style={{...td,textAlign:'center'}}>{totalUnits}</td>
                      <td style={{...td,textAlign:'center'}}>{totalLec}</td>
                      <td style={{...td,textAlign:'center'}}>{totalLab}</td>
                      <td style={{...td,textAlign:'center'}}>{totalCredit.toFixed(2)}</td>
                      <td style={{...td,textAlign:'center'}}>{totalContact}</td>
                      <td style={td}></td>
                    </tr>

                    {/* Non-teaching loads: Administrative, Research, Extension, Project,
                        plus hours-only Consultation / Lesson Preparation */}
                    {loadSections.map(sec => {
                      const isHoursOnlySection = HOURS_ONLY_TYPES.has(sec.key)
                      const totalHours = isHoursOnlySection ? sec.rows.reduce((a,r)=>a+Number(r.hours||0),0) : 0
                      return (
                        <Fragment key={sec.key}>
                          <tr><td style={{...td,fontWeight:'bold',background:'#fafafa'}} colSpan={10}>{sec.label}</td></tr>
                          {sec.rows.length > 0 ? sec.rows.map(a => (
                            <tr key={a.id}>
                              <td style={td}></td>
                              <td style={td} colSpan={2}>{isHoursOnlySection ? sec.label : a.description}</td>
                              <td style={td}></td>
                              <td style={{...td,textAlign:'center'}}>{isHoursOnlySection ? `${a.hours} hrs` : a.units}</td>
                              <td style={{...td,textAlign:'center'}}></td>
                              <td style={{...td,textAlign:'center'}}></td>
                              <td style={{...td,textAlign:'center'}}>{isHoursOnlySection ? '' : Number(a.units).toFixed(2)}</td>
                              <td style={{...td,textAlign:'center'}}></td>
                              <td style={td}></td>
                            </tr>
                          )) : (
                            <tr><td style={{...td,height:'24px'}} colSpan={10}></td></tr>
                          )}
                          <tr style={{background:'#f0f0f0',fontWeight:'bold'}}>
                            <td style={td} colSpan={4}>Total {sec.label}</td>
                            <td style={{...td,textAlign:'center'}}>{isHoursOnlySection ? (totalHours ? `${totalHours} hrs` : '') : (sec.total||'')}</td>
                            <td style={{...td,textAlign:'center'}}></td>
                            <td style={{...td,textAlign:'center'}}></td>
                            <td style={{...td,textAlign:'center'}}>{isHoursOnlySection ? '' : (sec.total?sec.total.toFixed(2):'')}</td>
                            <td style={{...td,textAlign:'center'}}></td>
                            <td style={td}></td>
                          </tr>
                        </Fragment>
                      )
                    })}

                    {/* Grand Total */}
                    <tr style={{background:'#e8e8e8',fontWeight:'bold'}}>
                      <td style={td} colSpan={4}>Total Load</td>
                      <td style={{...td,textAlign:'center'}}>{grandUnits}</td>
                      <td style={{...td,textAlign:'center'}}>{grandLec}</td>
                      <td style={{...td,textAlign:'center'}}>{grandLab}</td>
                      <td style={{...td,textAlign:'center'}}>{grandCredit.toFixed(2)}</td>
                      <td style={{...td,textAlign:'center'}}>{grandContact}</td>
                      <td style={td}></td>
                    </tr>
                  </tbody>
                </table>

                {/* Signature block */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px',padding:'16px 12px',borderTop:'1px solid #999',fontSize:'9pt'}}>
                  {[
                    {label:'Prepared by:', role:'Chairperson, BSIT Program'},
                    {label:'Checked by:', role:'Dean, CCIS'},
                    {label:'Reviewed by:', role:'Chief Curriculum Planning and Development'},
                    {label:'Approved by:', role:'Vice President for Academic Affairs and Quality Assurance'},
                  ].map((s,i) => (
                    <div key={i} style={{textAlign:'center'}}>
                      <div style={{fontWeight:'bold',marginBottom:'4px'}}>{s.label}</div>
                      <div style={{marginTop:'36px',borderTop:'1px solid #333',paddingTop:'4px'}}>&nbsp;</div>
                      <div style={{fontSize:'8pt',color:'#555'}}>{s.role}</div>
                      <div style={{marginTop:'12px',fontSize:'8pt'}}>Date: ___________</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <style>{`
        @media print {
          body > *:not(#print-root) { display: none !important; }
          .print\\:hidden { display: none !important; }
          .instructor-block { page-break-after: always; border: 1px solid black !important; }
          table { font-size: 9pt !important; }
        }
      `}</style>
    </div>
  )
}

const th = { border:'1px solid #999', padding:'4px 6px', textAlign:'center', fontWeight:'bold', fontSize:'9pt', verticalAlign:'middle' }
const td = { border:'1px solid #ccc', padding:'3px 5px', fontSize:'9pt', verticalAlign:'middle' }

const ROMAN_YEAR = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }

// Best-effort split of a free-typed "program_yr_sec" string (e.g. "BSIT 2A") into
// its Program and Section parts, using the entry's known year_level as an anchor.
function parseProgramSection(programYrSec, yearLevel) {
  const s = String(programYrSec || '').trim()
  if (!s) return { program: '—', section: '—' }
  if (yearLevel) {
    const anchored = s.match(new RegExp(`^(.*?)\\s*-?\\s*${yearLevel}\\s*([A-Za-z]+)$`))
    if (anchored && anchored[1].trim()) return { program: anchored[1].trim(), section: anchored[2].toUpperCase() }
  }
  const trailingLetters = s.match(/^(.*?)\s*([A-Za-z]+)$/)
  if (trailingLetters && trailingLetters[1].trim()) return { program: trailingLetters[1].trim(), section: trailingLetters[2].toUpperCase() }
  return { program: s, section: '—' }
}

/* ─── COURSE OFFERING VIEW ──────────────────────────────────── */
function CourseOfferingView({ entries, year, semester, dept, onClose }) {
  // Group entries by section (program_yr_sec) — one block per Program/Year/Section
  const sectionMap = {}
  for (const e of entries) {
    const key = e.program_yr_sec || '— No Section Set —'
    if (!sectionMap[key]) {
      const { program, section } = parseProgramSection(e.program_yr_sec, e.year_level)
      sectionMap[key] = { key, program, section, yearLevel: e.year_level, courses: [] }
    }
    sectionMap[key].courses.push(e)
  }
  const sections = Object.values(sectionMap).sort((a, b) => {
    if (a.yearLevel !== b.yearLevel) return (a.yearLevel || 0) - (b.yearLevel || 0)
    return a.key.localeCompare(b.key)
  })

  const semLabel = SEM_LABEL[semester]
  const handlePrint = () => window.print()

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-auto">
      <div className="print:hidden sticky top-0 bg-green-800 text-white flex items-center gap-4 px-6 py-3 shadow z-10">
        <button onClick={onClose} className="flex items-center gap-2 hover:text-amber-400 transition text-sm">
          <X className="w-4 h-4" /> Close Preview
        </button>
        <span className="text-green-300 text-sm">|</span>
        <span className="text-sm font-semibold">Course Offering — AY {year} {semLabel} Semester</span>
        <button onClick={handlePrint}
          className="ml-auto flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-green-900 font-bold px-4 py-1.5 rounded-lg transition text-sm">
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      <div className="p-6 print:p-0">
        {sections.map((sec) => {
          const totalUnits = sec.courses.reduce((a, c) => a + Number(c.units), 0)
          const totalLec   = sec.courses.reduce((a, c) => a + Number(c.lec_hours), 0)
          const totalLab   = sec.courses.reduce((a, c) => a + Number(c.lab_hours), 0)

          return (
            <div key={sec.key} className="mb-8 print:mb-0 print:page-break-after-always">
              <style>{`@media print { .course-offering-block { page-break-after: always; } }`}</style>
              <div className="course-offering-block border border-gray-400 print:border-black" style={{fontFamily:'Arial,sans-serif',fontSize:'10pt'}}>
                <div style={{textAlign:'center',padding:'8px 12px',borderBottom:'1px solid #999'}}>
                  <div style={{fontWeight:'bold',fontSize:'11pt'}}>{dept || 'DEPARTMENT'}</div>
                  <div style={{marginTop:'4px'}}>
                    Semester: <strong>{semLabel}</strong>&nbsp;&nbsp;&nbsp;Academic Year: <strong>{year}</strong>
                  </div>
                  <div style={{marginTop:'2px'}}>
                    Program: <strong>{sec.program}</strong>&nbsp;&nbsp;&nbsp;
                    Year Level: <strong>{ROMAN_YEAR[sec.yearLevel] || sec.yearLevel || '—'}</strong>&nbsp;&nbsp;&nbsp;
                    Section: <strong>{sec.section}</strong>
                  </div>
                </div>

                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'9pt'}}>
                  <thead>
                    <tr style={{background:'#f5f5f5'}}>
                      <th style={th} rowSpan={2}>Course No.</th>
                      <th style={th} rowSpan={2}>Descriptive Title</th>
                      <th style={th} rowSpan={2}>No. of Units</th>
                      <th style={{...th,textAlign:'center'}} colSpan={2}>No. of Hour/Week</th>
                      <th style={th} rowSpan={2}>Pre-requisite</th>
                      <th style={th} rowSpan={2}>Name of Instructor<br/>(LN, FN, MI.)</th>
                    </tr>
                    <tr style={{background:'#f5f5f5'}}>
                      <th style={th}>Lec</th>
                      <th style={th}>Lab</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.courses.map(c => (
                      <tr key={c.id}>
                        <td style={td}>{c.course_code}</td>
                        <td style={td}>{c.descriptive_title}</td>
                        <td style={{...td,textAlign:'center'}}>{c.units}</td>
                        <td style={{...td,textAlign:'center'}}>{c.lec_hours}</td>
                        <td style={{...td,textAlign:'center'}}>{c.lab_hours}</td>
                        <td style={{...td,textAlign:'center'}}>{c.prerequisite || 'None'}</td>
                        <td style={td}>{c.instructor_name || '— Unassigned —'}</td>
                      </tr>
                    ))}
                    <tr style={{background:'#f0f0f0',fontWeight:'bold'}}>
                      <td style={td} colSpan={2}>Total</td>
                      <td style={{...td,textAlign:'center'}}>{totalUnits}</td>
                      <td style={{...td,textAlign:'center'}}>{totalLec}</td>
                      <td style={{...td,textAlign:'center'}}>{totalLab}</td>
                      <td style={td} colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

        {/* Signature block — once, at the end of the whole document */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'8px',padding:'24px 12px',fontFamily:'Arial,sans-serif',fontSize:'9pt'}}>
          {[
            {label:'Prepared by:', role:'Signature over printed name of Program Chairperson'},
            {label:'Checked by:', role:'Signature over printed name of Dean'},
          ].map((s,i) => (
            <div key={i} style={{textAlign:'center'}}>
              <div style={{fontWeight:'bold',marginBottom:'4px'}}>{s.label}</div>
              <div style={{marginTop:'36px',borderTop:'1px solid #333',paddingTop:'4px'}}>&nbsp;</div>
              <div style={{fontSize:'8pt',color:'#555'}}>{s.role}</div>
              <div style={{marginTop:'12px',fontSize:'8pt'}}>Date: ___________</div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media print {
          body > *:not(#print-root) { display: none !important; }
          .print\\:hidden { display: none !important; }
          .course-offering-block { page-break-after: always; border: 1px solid black !important; }
          table { font-size: 9pt !important; }
        }
      `}</style>
    </div>
  )
}

/* ─── ADD ENTRY MODAL ───────────────────────────────────────── */
function AddEntryModal({ year, semester, prospectusSubjects, onSave, onClose, editEntry }) {
  const [form, setForm] = useState(editEntry ? {
    subject_id: editEntry.subject_id || '',
    course_code: editEntry.course_code,
    descriptive_title: editEntry.descriptive_title,
    program_yr_sec: editEntry.program_yr_sec,
    year_level: editEntry.year_level || '',
    units: editEntry.units,
    lec_hours: editEntry.lec_hours,
    lab_hours: editEntry.lab_hours,
    assigned_instructor_id: editEntry.assigned_instructor_id || '',
    room: editEntry.room || '',
  } : {
    subject_id: '', course_code: '', descriptive_title: '',
    program_yr_sec: '', year_level: '', units: 3, lec_hours: 3, lab_hours: 0,
    assigned_instructor_id: '', room: '',
  })

  const [instructors, setInstructors]   = useState([])
  const [loadingInstr, setLoadingInstr] = useState(false)
  const [saving, setSaving]             = useState(false)

  // When subject changes, fetch instructors sorted by specialty
  const loadInstructors = async (subjectId) => {
    if (!subjectId) {
      const res = await facultyLoadAPI.getAllInstructors(year, semester)
      setInstructors(res.data.map(i => ({ ...i, has_specialty: false })))
      return
    }
    setLoadingInstr(true)
    try {
      const res = await facultyLoadAPI.getInstructors(subjectId, year, semester)
      setInstructors(res.data)
    } catch { setInstructors([]) }
    finally { setLoadingInstr(false) }
  }

  useEffect(() => { loadInstructors(form.subject_id || null) }, [])

  const handleSubjectSelect = (e) => {
    const id = e.target.value
    const sub = prospectusSubjects.find(s => String(s.id) === String(id))
    if (sub) {
      setForm(f => ({
        ...f, subject_id: id,
        course_code: sub.course_code,
        descriptive_title: sub.descriptive_title,
        year_level: sub.year_level || '',
        units: sub.units, lec_hours: sub.lec_hours, lab_hours: sub.lab_hours,
      }))
      loadInstructors(id)
    } else {
      setForm(f => ({ ...f, subject_id: '' }))
      loadInstructors(null)
    }
  }

  const handleSave = async () => {
    if (!form.subject_id) {
      toast.error('Please select a subject from the uploaded prospectus.'); return
    }
    if (!form.program_yr_sec?.trim()) {
      toast.error('Section is required.'); return
    }
    setSaving(true)
    try { await onSave(form) }
    finally { setSaving(false) }
  }

  const specialists  = instructors.filter(i => i.has_specialty && !i.is_ge && !i.is_pathfit && !i.is_nstp)
  const geInstr      = instructors.filter(i => i.is_ge)
  const pathfitInstr = instructors.filter(i => i.is_pathfit)
  const nstpInstr    = instructors.filter(i => i.is_nstp)
  const others       = instructors.filter(i => !i.has_specialty && !i.is_ge && !i.is_pathfit && !i.is_nstp)

  const roleTag = (i) => i.role === 'chair' ? ' (Chair)' : i.role === 'dean' ? ' (Dean)' : ''

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-green-800 rounded-t-2xl">
          <p className="text-white font-bold">{editEntry ? 'Edit Assignment' : 'Add Subject Assignment'}</p>
          <button onClick={onClose} className="text-green-300 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Subject from prospectus — the only way to set the course identity;
              a subject that isn't in the uploaded prospectus can't be added. */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Select from Prospectus <span className="text-red-500">*</span></label>
            <select required value={form.subject_id} onChange={handleSubjectSelect}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 bg-white">
              <option value="">— Pick a subject —</option>
              {prospectusSubjects.map(s => (
                <option key={s.id} value={s.id}>{s.course_code} — {s.descriptive_title}</option>
              ))}
            </select>
            {!form.subject_id && (
              <p className="text-xs text-gray-400 mt-1">
                Only subjects from the uploaded prospectus can be added. Upload it first if it's missing.
              </p>
            )}
          </div>

          {form.subject_id && (
            <>
              {/* Course details — read-only, derived from the selected prospectus subject */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 space-y-1">
                <p className="text-sm font-semibold text-gray-700">{form.course_code} — {form.descriptive_title}</p>
                <p className="text-xs text-gray-500">
                  {form.units} units · {form.lec_hours}h Lec · {form.lab_hours}h Lab
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Section <span className="text-red-500">*</span></label>
                <input value={form.program_yr_sec} onChange={e=>setForm(f=>({...f,program_yr_sec:e.target.value}))}
                  placeholder="e.g. BSIT 2A"
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Year Level</label>
                <select value={form.year_level} onChange={e=>setForm(f=>({...f,year_level:e.target.value?Number(e.target.value):''}))}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 bg-white">
                  <option value="">— Not set —</option>
                  {Object.entries(YEAR_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {/* Computed preview */}
              <div className="bg-green-50 rounded-xl px-4 py-2 text-xs text-green-800 flex gap-4">
                <span>Unit Credit: <strong>{unitCredit(form.lec_hours,form.lab_hours).toFixed(2)}</strong></span>
                <span>Contact Hours: <strong>{contactHours(form.lec_hours,form.lab_hours)}</strong></span>
              </div>
            </>
          )}

          {/* Instructor */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Assign Instructor
              {loadingInstr && <span className="ml-2 text-gray-400">(loading...)</span>}
            </label>
            <select value={form.assigned_instructor_id}
              onChange={e=>setForm(f=>({...f,assigned_instructor_id:e.target.value}))}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 bg-white">
              <option value="">— Unassigned —</option>
              {specialists.length > 0 && (
                <optgroup label="⭐ Has Specialty (Recommended)">
                  {specialists.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.name} [{i.department}]{roleTag(i)} — {i.current_units} units loaded
                    </option>
                  ))}
                </optgroup>
              )}
              {geInstr.length > 0 && (
                <optgroup label="🎓 General Education Instructors">
                  {geInstr.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.name} [GE]{roleTag(i)} — {i.current_units} units loaded
                    </option>
                  ))}
                </optgroup>
              )}
              {pathfitInstr.length > 0 && (
                <optgroup label="🏃 PATHFIT Instructors">
                  {pathfitInstr.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.name} [PATHFIT]{roleTag(i)} — {i.current_units} units loaded
                    </option>
                  ))}
                </optgroup>
              )}
              {nstpInstr.length > 0 && (
                <optgroup label="🎖️ NSTP Instructors">
                  {nstpInstr.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.name} [NSTP]{roleTag(i)} — {i.current_units} units loaded
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Other Instructors">
                  {others.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.name} [{i.department||'—'}]{roleTag(i)} — {i.current_units} units loaded
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {specialists.length > 0 && (
              <p className="text-xs text-green-600 mt-1">
                ⭐ {specialists.length} instructor{specialists.length>1?'s':''} ha{specialists.length>1?'ve':'s'} selected this subject as their specialty.
              </p>
            )}
            {specialists.length === 0 && form.subject_id && !loadingInstr && (
              <p className="text-xs text-amber-600 mt-1">No instructor has selected this subject as their specialty yet.</p>
            )}
          </div>

          {/* Room */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Room / Lab</label>
            <input value={form.room} onChange={e=>setForm(f=>({...f,room:e.target.value}))}
              placeholder="e.g. ICT 204"
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin"/>Saving...</> : (editEntry?'Save Changes':'Add Assignment')}
            </button>
            <button onClick={onClose}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── MAIN PAGE ─────────────────────────────────────────────── */
export default function FacultyLoad() {
  const { user } = useAuth()
  const [tab, setTab] = useState('loading')   // 'prospectus' | 'loading'

  /* prospectus tab state */
  const fileRef = useRef(null)
  const [prospectuses, setProspectuses]   = useState([])
  const [loadingList, setLoadingList]     = useState(true)
  const [preview, setPreview]             = useState(null)
  const [expandedGroups, setExpandedGroups] = useState({})
  const [importing, setImporting]         = useState(false)
  const [academicYear, setAcademicYear]   = useState('2022-2023')
  const [programName, setProgramName]     = useState('BSIT')
  const [viewId, setViewId]               = useState(null)
  const [viewSubjects, setViewSubjects]   = useState([])
  const [viewGroups, setViewGroups]       = useState([])
  const [viewExpanded, setViewExpanded]   = useState({})

  /* faculty loading tab state */
  const [loadYear, setLoadYear]   = useState('2026-2027')
  const [loadSem, setLoadSem]     = useState(1)
  const [entries, setEntries]     = useState([])
  const [adminLoads, setAdminLoads] = useState([])
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [prospectusSubjects, setProspectusSubjects] = useState([])
  const [editEntry, setEditEntry]         = useState(null)
  const [showPrint, setShowPrint]         = useState(false)
  const [showCourseOffering, setShowCourseOffering] = useState(false)
  const [assignTarget, setAssignTarget] = useState(null)   // { instructorId, instructorName } — picker open for this instructor
  const [assigningId, setAssigningId]   = useState(null)   // entry id currently being assigned
  const [generating, setGenerating]       = useState(false)
  const [autoGenResult, setAutoGenResult] = useState(null)
  const [inlineEdit, setInlineEdit]       = useState(null)
  const [termStatus, setTermStatus]       = useState(null)   // current submission status for this term
  const [submitting, setSubmitting]       = useState(false)
  const [sectionCounts, setSectionCountsState] = useState({})   // { [year_level]: count }
  const [showSectionModal, setShowSectionModal] = useState(false)
  const [draftSectionCounts, setDraftSectionCounts] = useState({ 1:'', 2:'', 3:'', 4:'' })
  const [savingSections, setSavingSections] = useState(false)
  const [scheduleByEntry, setScheduleByEntry] = useState({})   // { [faculty_entry_id]: [slot, ...] }
  const [showOverloadedOnly, setShowOverloadedOnly] = useState(false)

  /* load prospectuses */
  const fetchProspectuses = async () => {
    try { const r = await prospectusAPI.getAll(); setProspectuses(r.data) }
    catch { toast.error('Failed to load prospectus list.') }
    finally { setLoadingList(false) }
  }
  useEffect(() => { fetchProspectuses() }, [])

  /* load faculty entries */
  const fetchEntries = async () => {
    setLoadingEntries(true)
    try {
      const r = await facultyLoadAPI.getAll(loadYear, loadSem)
      setEntries(r.data.entries); setAdminLoads(r.data.adminLoads)
    } catch { toast.error('Failed to load faculty load entries.') }
    finally { setLoadingEntries(false) }
  }

  /* load latest prospectus subjects for the selected semester (used in the add modal + auto-generate) */
  const fetchProspectusSubjects = async () => {
    try { const r = await prospectusAPI.getLatestSubjects(loadSem); setProspectusSubjects(r.data) }
    catch {}
  }

  const fetchTermStatus = async () => {
    try {
      const r = await submissionsAPI.getMyTermStatus(loadYear, loadSem)
      setTermStatus(r.data)
    } catch { setTermStatus(null) }
  }

  const fetchSectionCounts = async () => {
    try {
      const r = await facultyLoadAPI.getSectionCounts(loadYear, loadSem)
      setSectionCountsState(r.data)
    } catch { setSectionCountsState({}) }
  }

  /* Admin's published room/time assignments, once the schedule is generated and published */
  const fetchSchedule = async () => {
    try {
      const r = await schedulingAPI.getDept(loadYear, loadSem)
      const byEntry = {}
      for (const slot of r.data) {
        if (!byEntry[slot.faculty_entry_id]) byEntry[slot.faculty_entry_id] = []
        byEntry[slot.faculty_entry_id].push(slot)
      }
      setScheduleByEntry(byEntry)
    } catch { setScheduleByEntry({}) }
  }

  useEffect(() => {
    if (tab === 'loading') {
      fetchEntries()
      fetchProspectusSubjects()
      fetchTermStatus()
      fetchSectionCounts()
      fetchSchedule()
    }
  }, [tab, loadYear, loadSem])

  const openSectionModal = () => {
    setDraftSectionCounts({
      1: sectionCounts[1] ?? '', 2: sectionCounts[2] ?? '',
      3: sectionCounts[3] ?? '', 4: sectionCounts[4] ?? '',
    })
    setShowSectionModal(true)
  }

  const saveSectionCounts = async () => {
    setSavingSections(true)
    try {
      const counts = {}
      for (const [yr, val] of Object.entries(draftSectionCounts)) {
        if (val !== '' && Number(val) > 0) counts[yr] = Number(val)
      }
      await facultyLoadAPI.setSectionCounts(loadYear, loadSem, counts)
      toast.success('Section counts saved.')
      setShowSectionModal(false)
      fetchSectionCounts()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save section counts.')
    } finally {
      setSavingSections(false)
    }
  }

  const handleSubmitToVPAA = async () => {
    setSubmitting(true)
    try {
      await submissionsAPI.submitFromFacultyLoad({ academic_year: loadYear, semester: loadSem })
      toast.success('Faculty load submitted to VPAA for review!')
      fetchTermStatus()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  /* ── Prospectus handlers ── */
  const applyParsedSubjects = (filename, subjects) => {
    if (!subjects.length) { toast.error('No subjects found.'); return }
    const groups = groupSubjects(subjects)
    const exp = {}; groups.forEach(g => { exp[`${g.year_level}-${g.semester}`] = true })
    setPreview({ filename, subjects, groups })
    setExpandedGroups(exp)
    toast.success(`Parsed ${subjects.length} subjects`)
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return
    const isDocx = /\.docx$/i.test(file.name)
    const reader = new FileReader()

    if (isDocx) {
      // Word prospectus format — parsed server-side (needs mammoth), same
      // preview/import flow as the Excel format once we get subjects back.
      reader.onload = async (evt) => {
        try {
          const base64 = evt.target.result.split(',')[1]
          const res = await prospectusAPI.parseDocx({ data: base64 })
          applyParsedSubjects(file.name, res.data.subjects)
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed to parse Word document.')
        }
      }
      reader.readAsDataURL(file)
    } else {
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target.result, { type:'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })
          applyParsedSubjects(file.name, parseProspectus(rows))
        } catch (err) { toast.error('Failed to read file: ' + err.message) }
      }
      reader.readAsArrayBuffer(file)
    }
    e.target.value = ''
  }

  const handleImport = async () => {
    if (!preview) return; setImporting(true)
    try {
      const r = await prospectusAPI.import({ program: programName, academic_year: academicYear, filename: preview.filename, subjects: preview.subjects })
      toast.success(`Imported ${r.data.count} subjects!`); setPreview(null); fetchProspectuses()
    } catch (err) { toast.error(err.response?.data?.message || 'Import failed.') }
    finally { setImporting(false) }
  }

  const handleDeleteProspectus = async (p) => {
    if (!confirm(`Delete "${p.program} ${p.academic_year || ''}"?`)) return
    try { await prospectusAPI.remove(p.id); toast.success('Deleted.'); if (viewId===p.id){setViewId(null);setViewSubjects([]);setViewGroups([])} fetchProspectuses() }
    catch (err) { toast.error(err.response?.data?.message || 'Delete failed.') }
  }

  const handleViewProspectus = async (p) => {
    if (viewId===p.id) { setViewId(null);setViewSubjects([]);setViewGroups([]);return }
    try {
      const r = await prospectusAPI.getSubjects(p.id)
      const groups = groupSubjects(r.data); const exp={}
      groups.forEach(g=>{exp[`${g.year_level}-${g.semester}`]=true})
      setViewId(p.id);setViewSubjects(r.data);setViewGroups(groups);setViewExpanded(exp)
    } catch { toast.error('Failed to load subjects.') }
  }

  const toggleGroup = (key, isView=false) => {
    if (isView) setViewExpanded(e=>({...e,[key]:!e[key]}))
    else setExpandedGroups(e=>({...e,[key]:!e[key]}))
  }

  /* ── Faculty Load handlers ── */

  const handleEditEntry = async (form) => {
    try {
      await facultyLoadAPI.update(editEntry.id, form)
      toast.success('Updated!'); setEditEntry(null); fetchEntries()
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to update.') }
  }

  // Removing a row from an instructor's table unassigns it (moves it to the
  // Unassigned list) instead of deleting it outright, so the subject can be
  // picked up by another instructor later. Rows already in the Unassigned
  // list have nothing left to unassign, so those are deleted for real.
  const handleDeleteEntry = async (entry) => {
    try {
      if (entry.assigned_instructor_id) {
        await facultyLoadAPI.update(entry.id, { ...entry, assigned_instructor_id: null })
        toast.success('Unassigned — moved to the Unassigned list.')
      } else {
        await facultyLoadAPI.remove(entry.id)
        toast.success('Removed.')
      }
      fetchEntries()
    } catch (err) { toast.error(err.response?.data?.message||'Failed.') }
  }

  const handleAssignToInstructor = async (entry, instructorId, instructorName) => {
    setAssigningId(entry.id)
    try {
      await facultyLoadAPI.update(entry.id, { ...entry, assigned_instructor_id: instructorId })
      toast.success(`Assigned to ${instructorName}.`)
      fetchEntries()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to assign.')
    } finally {
      setAssigningId(null)
    }
  }

  const handleRemoveLoad = async (id) => {
    try {
      await facultyLoadAPI.removeAdminLoad(id)
      toast.success('Removed.')
      fetchEntries()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to remove.')
    }
  }

  const handleAutoGenerate = async (clearExisting) => {
    setGenerating(true)
    try {
      const r = await facultyLoadAPI.autoGenerate({
        academic_year: loadYear, semester: loadSem, clear_existing: clearExisting
      })
      setAutoGenResult(r.data)
      toast.success(`Generated ${r.data.count} entries — ${r.data.assigned} assigned, ${r.data.unassigned} need manual assignment.`)
      fetchEntries()
    } catch (err) { toast.error(err.response?.data?.message || 'Auto-generate failed.') }
    finally { setGenerating(false) }
  }

  /* Inline edit save */
  const saveInlineEdit = async () => {
    if (!inlineEdit) return
    const entry = entries.find(e => e.id === inlineEdit.id)
    if (!entry) { setInlineEdit(null); return }
    try {
      await facultyLoadAPI.update(inlineEdit.id, { ...entry, [inlineEdit.field]: inlineEdit.value })
      setInlineEdit(null); fetchEntries()
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to save.') }
  }

  /* Group entries by instructor for screen view */
  const instructorGroups = {}
  for (const e of entries) {
    const key = e.assigned_instructor_id || '__none__'
    const name = e.instructor_name || '— Unassigned —'
    if (!instructorGroups[key]) instructorGroups[key] = { instructorId: e.assigned_instructor_id || null, name, dept: e.instructor_dept || '', entries: [] }
    instructorGroups[key].entries.push(e)
  }
  // An instructor with only administrative/research/extension/project load (no
  // teaching entries yet) still needs their own card so that load is visible.
  for (const l of adminLoads) {
    if (!instructorGroups[l.instructor_id]) {
      instructorGroups[l.instructor_id] = { instructorId: l.instructor_id, name: l.instructor_name || '—', dept: '', entries: [] }
    }
  }
  const groupedInstructors = Object.values(instructorGroups)

  // Anyone over the hard unit-credit cap — Auto-Generate will assign a
  // specialist even past the cap rather than leave a subject unassigned, so
  // this has to be checked before submitting (mirrors the server-side guard).
  const groupCredit = (grp) => {
    const totalCredit = grp.entries.reduce((a,e)=>a+unitCredit(e.lec_hours,e.lab_hours),0)
    const otherCredit  = grp.instructorId ? adminLoads.filter(l => l.instructor_id === grp.instructorId).reduce((a,l)=>a+Number(l.units),0) : 0
    return totalCredit + otherCredit
  }
  const overloadedInstructors = groupedInstructors
    .filter(grp => grp.instructorId && groupCredit(grp) > MAX_UNITS)
    .map(grp => ({ name: grp.name, credit: groupCredit(grp) }))

  const visibleGroupedInstructors = showOverloadedOnly
    ? groupedInstructors.filter(grp => grp.instructorId && groupCredit(grp) > MAX_UNITS)
    : groupedInstructors

  return (
    <div>
      <PageHeader title="Faculty Load" subtitle="Upload the curriculum prospectus and generate the Faculty Loading Sheet." />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-2xl p-1 w-fit">
        {[['prospectus','Prospectus Upload'],['loading','Faculty Loading Sheet']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${tab===key?'bg-white text-green-800 shadow':'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: PROSPECTUS ── */}
      {tab === 'prospectus' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white font-semibold px-4 py-2.5 rounded-xl transition shadow text-sm">
              <Upload className="w-4 h-4" /> Upload Prospectus (.xlsx or .docx)
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.docx" className="hidden" onChange={handleFileChange} />

          {preview && (
            <div className="mb-8 bg-white rounded-2xl shadow-sm border-2 border-green-400">
              <div className="flex items-center justify-between px-6 py-4 border-b bg-green-50 rounded-t-2xl">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-green-700" />
                  <div>
                    <p className="font-bold text-green-900">Preview: {preview.filename}</p>
                    <p className="text-green-700 text-xs mt-0.5">{preview.subjects.length} subjects across {preview.groups.length} groups</p>
                  </div>
                </div>
                <button onClick={()=>setPreview(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="px-6 py-4 border-b flex flex-wrap gap-4 items-end">
                {[['Program',programName,setProgramName,'w-32'],['Academic Year',academicYear,setAcademicYear,'w-40']].map(([label,val,set,w])=>(
                  <div key={label}>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
                    <input value={val} onChange={e=>set(e.target.value)} className={`border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500 ${w}`} />
                  </div>
                ))}
                <button onClick={handleImport} disabled={importing}
                  className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold px-5 py-2.5 rounded-xl transition text-sm">
                  {importing?<><Loader2 className="w-4 h-4 animate-spin"/>Importing...</>:<><CheckCircle2 className="w-4 h-4"/>Import to Database</>}
                </button>
              </div>
              <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
                {preview.groups.map(g => {
                  const key=`${g.year_level}-${g.semester}`; const open=expandedGroups[key]
                  return (
                    <div key={key} className={`rounded-xl border-2 overflow-hidden ${YEAR_COLORS[g.year_level]}`}>
                      <button onClick={()=>toggleGroup(key)} className="w-full flex items-center justify-between px-4 py-3 text-left font-bold text-sm">
                        <span>{YEAR_LABEL[g.year_level]} — {SEM_LABEL[g.semester]} Semester</span>
                        <span className="flex items-center gap-2"><span className="text-xs font-normal opacity-70">{g.subjects.length} subjects</span>{open?<ChevronUp className="w-4 h-4"/>:<ChevronDown className="w-4 h-4"/>}</span>
                      </button>
                      {open && (
                        <div className="bg-white border-t-2 border-inherit overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="bg-gray-50 text-gray-500">
                              <th className="px-3 py-2 text-left font-semibold">Course No.</th>
                              <th className="px-3 py-2 text-left font-semibold">Descriptive Title</th>
                              <th className="px-3 py-2 text-center font-semibold">Units</th>
                              <th className="px-3 py-2 text-center font-semibold">Lec</th>
                              <th className="px-3 py-2 text-center font-semibold">Lab</th>
                              <th className="px-3 py-2 text-left font-semibold">Pre-requisite</th>
                            </tr></thead>
                            <tbody className="divide-y divide-gray-100">
                              {g.subjects.map((s,i)=>(
                                <tr key={i} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 font-mono font-semibold text-green-800">{s.course_code}</td>
                                  <td className="px-3 py-2 text-gray-700">{s.descriptive_title}</td>
                                  <td className="px-3 py-2 text-center text-gray-600">{s.units||'—'}</td>
                                  <td className="px-3 py-2 text-center text-gray-500">{s.lec_hours||'—'}</td>
                                  <td className="px-3 py-2 text-center text-gray-500">{s.lab_hours||'—'}</td>
                                  <td className="px-3 py-2 text-gray-400 italic">{s.prerequisite||'None'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50"><h3 className="font-bold text-gray-800 flex items-center gap-2"><BookOpen className="w-4 h-4 text-green-700"/>Imported Prospectuses</h3></div>
            {loadingList ? (
              <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2"/>Loading...</div>
            ) : prospectuses.length===0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400"><FileSpreadsheet className="w-10 h-10 mb-3 opacity-30"/><p className="font-medium">No prospectus imported yet.</p></div>
            ) : (
              <div className="divide-y divide-gray-100">
                {prospectuses.map(p => (
                  <div key={p.id}>
                    <div className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition">
                      <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0"><FileSpreadsheet className="w-5 h-5 text-green-700"/></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800">{p.program}{p.academic_year&&<span className="text-gray-500 font-normal ml-2">AY {p.academic_year}</span>}</p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{p.filename&&<><span className="text-green-700">{p.filename}</span> · </>}Uploaded by {p.uploaded_by_name} · {new Date(p.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-xs bg-green-100 text-green-800 font-semibold px-2.5 py-1 rounded-full"><BookOpen className="w-3 h-3"/>{p.subject_count} subjects</span>
                        <button onClick={()=>handleViewProspectus(p)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${viewId===p.id?'bg-green-700 text-white':'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}>{viewId===p.id?'Hide':'View'}</button>
                        <button onClick={()=>handleDeleteProspectus(p)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    </div>
                    {viewId===p.id && viewGroups.length>0 && (
                      <div className="px-6 pb-5 space-y-3 bg-gray-50 border-t border-gray-100">
                        <div className="pt-4 flex items-center gap-2 text-xs text-gray-500"><Users className="w-3.5 h-3.5"/><span>{viewSubjects.length} subjects total</span></div>
                        {viewGroups.map(g=>{
                          const key=`${g.year_level}-${g.semester}`; const open=viewExpanded[key]
                          return (
                            <div key={key} className={`rounded-xl border-2 overflow-hidden ${YEAR_COLORS[g.year_level]}`}>
                              <button onClick={()=>toggleGroup(key,true)} className="w-full flex items-center justify-between px-4 py-2.5 text-left font-bold text-sm">
                                <span>{YEAR_LABEL[g.year_level]} — {SEM_LABEL[g.semester]} Semester</span>
                                <span className="flex items-center gap-2"><span className="text-xs font-normal opacity-70">{g.subjects.length}</span>{open?<ChevronUp className="w-4 h-4"/>:<ChevronDown className="w-4 h-4"/>}</span>
                              </button>
                              {open && (
                                <div className="bg-white border-t-2 border-inherit overflow-x-auto">
                                  <table className="w-full text-xs"><thead><tr className="bg-gray-50 text-gray-500"><th className="px-3 py-2 text-left">Course No.</th><th className="px-3 py-2 text-left">Title</th><th className="px-3 py-2 text-center">Units</th><th className="px-3 py-2 text-center">Lec</th><th className="px-3 py-2 text-center">Lab</th></tr></thead>
                                  <tbody className="divide-y divide-gray-100">{g.subjects.map((s,i)=><tr key={i}><td className="px-3 py-2 font-mono text-green-800 font-semibold">{s.course_code}</td><td className="px-3 py-2 text-gray-700">{s.descriptive_title}</td><td className="px-3 py-2 text-center">{s.units}</td><td className="px-3 py-2 text-center">{s.lec_hours}</td><td className="px-3 py-2 text-center">{s.lab_hours}</td></tr>)}</tbody></table>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: FACULTY LOADING ── */}
      {tab === 'loading' && (
        <div>
          {/* Controls bar */}
          <div className="flex flex-wrap items-end gap-4 mb-5">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
              <input value={loadYear} onChange={e=>setLoadYear(e.target.value)}
                className="border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 w-36" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
              <select value={loadSem} onChange={e=>setLoadSem(Number(e.target.value))}
                className="border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 bg-white">
                <option value={1}>1st Semester</option>
                <option value={2}>2nd Semester</option>
                <option value={3}>Summer</option>
              </select>
            </div>
            <div className="flex gap-2 ml-auto flex-wrap">
              {/* Sections per year level — configures Auto-Generate */}
              <button onClick={openSectionModal}
                className="flex items-center gap-2 bg-white hover:bg-gray-50 border-2 border-gray-200 text-gray-700 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Layers className="w-4 h-4"/> Sections
                {Object.keys(sectionCounts).length > 0 && (
                  <span className="bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {Object.entries(sectionCounts).map(([y,c])=>`Y${y}:${c}`).join(' ')}
                  </span>
                )}
              </button>
              {/* Auto-generate — primary action */}
              {entries.length > 0 ? (
                <>
                  <button
                    onClick={() => handleAutoGenerate(false)}
                    disabled={generating || prospectusSubjects.length === 0}
                    title="Fills only currently-unassigned subjects with newly-eligible specialists — safe to re-run, nothing already assigned is touched or duplicated."
                    className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl transition shadow text-sm">
                    {generating
                      ? <><Loader2 className="w-4 h-4 animate-spin"/>Generating...</>
                      : <><GraduationCap className="w-4 h-4"/>Fill Unassigned Gaps</>}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`This will REPLACE the current ${entries.length} entries with auto-generated assignments. Continue?`)) {
                        handleAutoGenerate(true)
                      }
                    }}
                    disabled={generating || prospectusSubjects.length === 0}
                    title="Deletes every entry for this term and regenerates from scratch."
                    className="flex items-center gap-2 bg-white hover:bg-red-50 border-2 border-red-200 text-red-700 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                    <GraduationCap className="w-4 h-4"/> Regenerate All
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleAutoGenerate(false)}
                  disabled={generating || prospectusSubjects.length === 0}
                  className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl transition shadow text-sm">
                  {generating
                    ? <><Loader2 className="w-4 h-4 animate-spin"/>Generating...</>
                    : <><GraduationCap className="w-4 h-4"/>Auto-Generate Assignments</>}
                </button>
              )}
              {entries.length > 0 && (
                <button onClick={()=>setShowPrint(true)}
                  className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 py-2.5 rounded-xl transition shadow text-sm">
                  <Printer className="w-4 h-4"/> Loading Sheet
                </button>
              )}
              {entries.length > 0 && (
                <button onClick={()=>setShowCourseOffering(true)}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2.5 rounded-xl transition shadow text-sm">
                  <Printer className="w-4 h-4"/> Course Offering
                </button>
              )}
            </div>
          </div>

          {/* No prospectus warning */}
          {prospectusSubjects.length === 0 && (
            <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="text-lg leading-none">⚠</span>
              <span>No prospectus uploaded yet. Go to the <button onClick={()=>setTab('prospectus')} className="font-bold underline">Prospectus Upload</button> tab first, then come back to auto-generate.</span>
            </div>
          )}

          {/* Auto-gen result banner */}
          {autoGenResult && (
            <div className="mb-4 flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
              <span>
                Generated <strong>{autoGenResult.count}</strong> class assignments from the prospectus
                {autoGenResult.dept && <> for <strong>{autoGenResult.dept}</strong></>}.
                {' '}<strong className="text-green-700">{autoGenResult.assigned} assigned</strong>
                {autoGenResult.unassigned > 0 && <>, <span className="text-amber-700 font-semibold">{autoGenResult.unassigned} need manual assignment</span></>}.
              </span>
              <button onClick={()=>setAutoGenResult(null)} className="text-green-600 hover:text-green-800 ml-4"><X className="w-4 h-4"/></button>
            </div>
          )}

          {/* Unassigned warning */}
          {entries.some(e => !e.assigned_instructor_id) && (
            <div className="mb-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="text-base">⚠</span>
              <span><strong>{entries.filter(e=>!e.assigned_instructor_id).length} subject{entries.filter(e=>!e.assigned_instructor_id).length>1?'s':''}</strong> still have no instructor assigned — click the edit button on those rows to assign manually.</span>
            </div>
          )}

          {/* Overload warning */}
          {overloadedInstructors.length > 0 && (
            <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
              <span className="text-base">⚠</span>
              <span className="flex-1">
                <strong>{overloadedInstructors.length} instructor{overloadedInstructors.length > 1 ? 's are' : ' is'}</strong> over the {MAX_UNITS}-unit cap:
                {' '}{overloadedInstructors.map(g => `${g.name} (${g.credit.toFixed(2)} units)`).join(', ')}.
                {' '}Unassign a subject from their card or reduce their other load before submitting.
              </span>
              <button onClick={() => setShowOverloadedOnly(v => !v)}
                className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                  showOverloadedOnly ? 'bg-red-600 text-white' : 'bg-white border border-red-300 text-red-700 hover:bg-red-100'
                }`}>
                {showOverloadedOnly ? 'Showing Overloaded Only ✕' : 'Show Overloaded Only'}
              </button>
            </div>
          )}
          {showOverloadedOnly && overloadedInstructors.length === 0 && (
            <div className="mb-4 flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
              <span>✓ Nobody is over the {MAX_UNITS}-unit cap anymore.</span>
              <button onClick={() => setShowOverloadedOnly(false)}
                className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-green-300 text-green-700 hover:bg-green-100 transition">
                Show All Instructors
              </button>
            </div>
          )}

          {/* ── Submit for Approval banner ── */}
          {entries.length > 0 && (() => {
            const status = termStatus?.status
            if (!status || status === 'returned') {
              const unassignedCount = entries.filter(e => !e.assigned_instructor_id).length
              const hasAnyAssigned = entries.some(e => e.assigned_instructor_id)
              const blocked = !hasAnyAssigned || overloadedInstructors.length > 0
              return (
                <div className="mb-4 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Send className="w-4 h-4 text-blue-700 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-blue-900">
                        {status === 'returned' ? 'Submission was returned for revision.' : 'Faculty load is ready for approval.'}
                      </p>
                      <p className="text-xs text-blue-600 mt-0.5">
                        {!hasAnyAssigned
                          ? 'Assign at least one instructor before submitting.'
                          : overloadedInstructors.length > 0
                          ? 'Resolve the overload above before submitting.'
                          : unassignedCount > 0
                          ? `${unassignedCount} subject${unassignedCount > 1 ? 's' : ''} still ${unassignedCount > 1 ? 'have' : 'has'} no instructor — that's fine to submit if you're short-staffed, they'll just need one assigned later. Every assigned instructor below must confirm their own load, then it goes to the Dean, Quality Assurance, and finally the VPAA.`
                          : 'Every instructor assigned below must confirm their load, then it goes to the Dean, Quality Assurance, and finally the VPAA.'}
                      </p>
                    </div>
                  </div>
                  <button onClick={handleSubmitToVPAA} disabled={submitting || blocked}
                    title={blocked ? (overloadedInstructors.length > 0 ? 'Resolve instructor overload first.' : 'Assign at least one instructor first.') : undefined}
                    className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold px-4 py-2.5 rounded-xl transition text-sm shrink-0 ml-4">
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin"/>Submitting...</> : <><Send className="w-4 h-4"/>{status === 'returned' ? 'Re-submit' : 'Submit for Approval'}</>}
                  </button>
                </div>
              )
            }
            if (status === 'pending_instructor') {
              const conf = termStatus?.confirmations
              return (
                <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>
                    <strong>Awaiting instructor confirmation</strong>
                    {conf && ` — ${conf.confirmed} of ${conf.total} instructors have confirmed their load.`}
                    {' '}You can still edit assignments; instructors will see changes in real time.
                  </span>
                </div>
              )
            }
            if (status === 'pending_dean') return (
              <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                <Clock className="w-4 h-4 shrink-0" />
                <span><strong>Confirmed by all instructors</strong> — awaiting Dean's review.</span>
              </div>
            )
            if (status === 'pending_qa') return (
              <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                <Clock className="w-4 h-4 shrink-0" />
                <span><strong>Confirmed by Dean</strong> — awaiting Quality Assurance review.</span>
              </div>
            )
            if (status === 'pending_vpaa') return (
              <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                <Clock className="w-4 h-4 shrink-0" />
                <span><strong>Confirmed by Quality Assurance</strong> — awaiting VPAA endorsement.</span>
              </div>
            )
            if (['pending_admin', 'validated', 'scheduled'].includes(status)) return (
              <div className="mb-4 flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
                <CheckCircle className="w-4 h-4 shrink-0 text-green-600" />
                <span>
                  <strong>Endorsed by VPAA</strong>
                  {status === 'validated' && ' · Validated by Admin'}
                  {status === 'scheduled' && ' · Schedule Generated'}
                  {' '}— this term's faculty load has been approved.
                </span>
              </div>
            )
            return null
          })()}

          {/* Entries table grouped by instructor — only show the full-page
              spinner on the true first load; a background refresh after
              editing/deleting/assigning a row keeps the existing list
              mounted so the page doesn't collapse and reset your scroll
              position back to the top. */}
          {loadingEntries && entries.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2"/>Loading...</div>
          ) : entries.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
              <GraduationCap className="w-12 h-12 mb-3 opacity-30"/>
              <p className="font-semibold text-gray-500 text-base">Ready to generate the Faculty Loading Sheet</p>
              <p className="text-sm mt-1 text-gray-400 max-w-sm text-center">
                Click <strong className="text-green-700">Auto-Generate Assignments</strong> above — the system will assign instructors from your department based on their selected specialty.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {visibleGroupedInstructors.map((grp, gi) => {
                const isUnassigned  = grp.entries[0] && !grp.entries[0].assigned_instructor_id
                const totalU        = grp.entries.reduce((a,e)=>a+Number(e.units),0)
                const totalLec      = grp.entries.reduce((a,e)=>a+Number(e.lec_hours),0)
                const totalLab      = grp.entries.reduce((a,e)=>a+Number(e.lab_hours),0)
                const totalCredit   = grp.entries.reduce((a,e)=>a+unitCredit(e.lec_hours,e.lab_hours),0)
                const totalContact  = grp.entries.reduce((a,e)=>a+contactHours(e.lec_hours,e.lab_hours),0)
                const instructorLoads = isUnassigned ? [] : adminLoads.filter(l => l.instructor_id === grp.instructorId)
                // Other Loads have no lec/lab hours — their unit credit is just their unit value directly
                const totalOther       = instructorLoads.reduce((a,l)=>a+Number(l.units),0)
                const totalOtherCredit = totalOther
                // Consultation/Lesson Prep are hours-only — excluded from Unit Credit
                // above (units=0), but their real weekly hours roll into Contact Hrs.
                const totalHoursOnly = instructorLoads
                  .filter(l => HOURS_ONLY_TYPES.has(l.load_type))
                  .reduce((a,l)=>a+Number(l.hours||0),0)
                const grandTotal       = totalU + totalOther
                const grandCredit      = totalCredit + totalOtherCredit
                const grandContact     = totalContact + totalHoursOnly
                // The 21/27 cap is on Unit Credit (Lec + Lab×0.75), not the nominal Units count
                const overMax    = grandCredit > MAX_UNITS
                const overTarget = grandCredit > TARGET_UNITS
                const overContactMax = grandContact > CONTACT_HRS_MAX
                return (
                  <div key={gi} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className={`flex items-center justify-between px-5 py-3 ${isUnassigned ? 'bg-amber-600' : 'bg-green-800'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUnassigned ? 'bg-amber-200' : 'bg-amber-400'}`}>
                          <span className={`font-bold text-xs ${isUnassigned ? 'text-amber-800' : 'text-green-900'}`}>
                            {grp.name.charAt(0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-white font-bold">{grp.name.toUpperCase()}</span>
                          {grp.dept && (
                            <span className="ml-2 text-xs text-green-300 font-medium">— {grp.dept}</span>
                          )}
                          {isUnassigned && <span className="ml-2 text-xs bg-amber-200 text-amber-900 font-semibold px-2 py-0.5 rounded-full">Needs Assignment</span>}
                          {overMax && (
                            <span
                              title={`${grandCredit.toFixed(2)} unit credit — over the ${MAX_UNITS}-unit hard cap. Unassign a subject or reduce their other load before submitting.`}
                              className="ml-2 text-xs bg-red-500 text-white font-bold px-2 py-0.5 rounded-full animate-pulse">
                              ⚠ OVERLOADED
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          title={totalOther > 0 ? `${totalCredit.toFixed(2)} teaching credit + ${totalOtherCredit.toFixed(2)} other credit = ${grandCredit.toFixed(2)} unit credit total (cap: ${TARGET_UNITS}, max: ${MAX_UNITS})` : undefined}
                          className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                            overMax ? 'bg-red-200 text-red-900'
                            : overTarget ? 'bg-orange-200 text-orange-900'
                            : isUnassigned ? 'bg-amber-200 text-amber-900' : 'bg-amber-400 text-green-900'
                          }`}>
                          {totalOther > 0
                            ? `${grandCredit.toFixed(2)} unit credit (${totalU} teaching + ${totalOther} other units)`
                            : `${totalCredit.toFixed(2)} credit · ${totalU} units · ${totalLec}L/${totalLab}Lab`}
                          {overMax && ' ⚠ Over max'}
                        </span>
                        {!isUnassigned && (
                          <button
                            onClick={() => setAssignTarget({ instructorId: grp.instructorId, instructorName: grp.name })}
                            title="Assign a subject from the Unassigned list"
                            className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-2.5 py-1 rounded-full transition"
                          >
                            <Plus className="w-3.5 h-3.5" /> Assign
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            {['Course No.','Descriptive Title','Section ✎','Year','Units','Lec','Lab','Unit Credit','Contact Hrs','Room ✎','Scheduled Room',''].map(h=>(
                              <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {grp.entries.map(e => {
                            const editingSection = inlineEdit?.id === e.id && inlineEdit.field === 'program_yr_sec'
                            const editingRoom    = inlineEdit?.id === e.id && inlineEdit.field === 'room'
                            return (
                              <tr key={e.id} className="hover:bg-gray-50 transition">
                                <td className="px-4 py-2.5 font-mono font-semibold text-green-800 text-xs whitespace-nowrap">{e.course_code}</td>
                                <td className="px-4 py-2.5 text-gray-700 text-xs">{e.descriptive_title}</td>
                                {/* Inline-editable Section */}
                                <td className="px-2 py-1.5 text-xs">
                                  {editingSection ? (
                                    <input autoFocus value={inlineEdit.value}
                                      onChange={ev=>setInlineEdit(s=>({...s,value:ev.target.value}))}
                                      onBlur={saveInlineEdit}
                                      onKeyDown={ev=>{ if(ev.key==='Enter') saveInlineEdit(); if(ev.key==='Escape') setInlineEdit(null) }}
                                      className="border-2 border-green-500 rounded-lg px-2 py-1 text-xs w-28 focus:outline-none" />
                                  ) : (
                                    <button onClick={()=>setInlineEdit({id:e.id,field:'program_yr_sec',value:e.program_yr_sec||''})}
                                      className={`px-2 py-1 rounded-lg border border-dashed text-left w-full min-w-[80px] transition hover:border-green-500 hover:bg-green-50 ${e.program_yr_sec ? 'border-gray-200 text-gray-700 font-medium' : 'border-amber-300 text-amber-500 italic'}`}>
                                      {e.program_yr_sec || 'Click to set'}
                                    </button>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-center text-xs whitespace-nowrap">
                                  {e.year_level ? (
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${YEAR_COLORS[e.year_level]}`}>
                                      {YEAR_LABEL[e.year_level]}
                                    </span>
                                  ) : (
                                    <span className="text-gray-300 italic">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-center text-gray-600 text-xs">{e.units}</td>
                                <td className="px-4 py-2.5 text-center text-gray-500 text-xs">{e.lec_hours}</td>
                                <td className="px-4 py-2.5 text-center text-gray-500 text-xs">{e.lab_hours}</td>
                                <td className="px-4 py-2.5 text-center text-blue-600 text-xs font-semibold">{unitCredit(e.lec_hours,e.lab_hours).toFixed(2)}</td>
                                <td className="px-4 py-2.5 text-center text-gray-600 text-xs">{contactHours(e.lec_hours,e.lab_hours)}</td>
                                {/* Inline-editable Room */}
                                <td className="px-2 py-1.5 text-xs">
                                  {editingRoom ? (
                                    <input autoFocus value={inlineEdit.value}
                                      onChange={ev=>setInlineEdit(s=>({...s,value:ev.target.value}))}
                                      onBlur={saveInlineEdit}
                                      onKeyDown={ev=>{ if(ev.key==='Enter') saveInlineEdit(); if(ev.key==='Escape') setInlineEdit(null) }}
                                      className="border-2 border-green-500 rounded-lg px-2 py-1 text-xs w-24 focus:outline-none" />
                                  ) : (
                                    <button onClick={()=>setInlineEdit({id:e.id,field:'room',value:e.room||''})}
                                      className={`px-2 py-1 rounded-lg border border-dashed text-left w-full min-w-[64px] transition hover:border-green-500 hover:bg-green-50 ${e.room ? 'border-gray-200 text-gray-600' : 'border-gray-200 text-gray-300 italic'}`}>
                                      {e.room || '—'}
                                    </button>
                                  )}
                                </td>
                                {/* Admin's published room/time assignment (read-only) */}
                                <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                                  {(scheduleByEntry[e.id] || []).length === 0 ? (
                                    <span className="text-gray-300 italic">Not yet scheduled</span>
                                  ) : (
                                    <div className="flex flex-col gap-0.5">
                                      {scheduleByEntry[e.id].map(slot => (
                                        <span key={slot.id}
                                          title={`${slot.days} ${slot.start_time?.slice(0,5)}–${slot.end_time?.slice(0,5)}`}
                                          className="flex items-center gap-1 text-gray-700">
                                          <DoorOpen className="w-3 h-3 text-green-600 shrink-0" />
                                          <span className="font-medium">{slot.room_name || '—'}</span>
                                          <span className="text-[10px] text-gray-400">({slot.session_type})</span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex gap-1">
                                    <button onClick={()=>setEditEntry(e)} title="Edit full details"
                                      className="p-1.5 text-gray-400 hover:text-green-700 hover:bg-green-50 rounded-lg transition"><Edit2 className="w-3.5 h-3.5"/></button>
                                    <button onClick={()=>handleDeleteEntry(e)}
                                      title={e.assigned_instructor_id ? 'Unassign (moves to Unassigned list)' : 'Delete permanently'}
                                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-3.5 h-3.5"/></button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-green-50 font-bold text-xs">
                            <td className="px-4 py-2" colSpan={4}>Total Academic Load</td>
                            <td className="px-4 py-2 text-center">{totalU}</td>
                            <td className="px-4 py-2 text-center">{totalLec}</td>
                            <td className="px-4 py-2 text-center">{totalLab}</td>
                            <td className="px-4 py-2 text-center text-blue-700">{totalCredit.toFixed(2)}</td>
                            <td className="px-4 py-2 text-center">{totalContact}</td>
                            <td colSpan={3}></td>
                          </tr>
                          {!isUnassigned && (totalOther > 0 || totalHoursOnly > 0) && (
                            <>
                              {totalOther > 0 && (
                                <tr className="bg-gray-50 font-semibold text-xs text-gray-600">
                                  <td className="px-4 py-2" colSpan={4}>Total Other Loads (Admin/Research/Extension/Project)</td>
                                  <td className="px-4 py-2 text-center">{totalOther}</td>
                                  <td className="px-4 py-2 text-center">—</td>
                                  <td className="px-4 py-2 text-center">—</td>
                                  <td className="px-4 py-2 text-center text-blue-700">{totalOtherCredit.toFixed(2)}</td>
                                  <td className="px-4 py-2 text-center">—</td>
                                  <td colSpan={3}></td>
                                </tr>
                              )}
                              {totalHoursOnly > 0 && (
                                <tr className="bg-gray-50 font-semibold text-xs text-gray-600">
                                  <td className="px-4 py-2" colSpan={4}>Total Consultation/Lesson Prep Hours</td>
                                  <td className="px-4 py-2 text-center">—</td>
                                  <td className="px-4 py-2 text-center">—</td>
                                  <td className="px-4 py-2 text-center">—</td>
                                  <td className="px-4 py-2 text-center">—</td>
                                  <td className="px-4 py-2 text-center">{totalHoursOnly} hrs</td>
                                  <td colSpan={3}></td>
                                </tr>
                              )}
                              <tr className={`font-bold text-xs ${overMax ? 'bg-red-100 text-red-800' : overTarget ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                                <td className="px-4 py-2" colSpan={4}>Grand Total {overMax && '⚠ Over Maximum Load'}</td>
                                <td className="px-4 py-2 text-center">{grandTotal}</td>
                                <td className="px-4 py-2 text-center">{totalLec}</td>
                                <td className="px-4 py-2 text-center">{totalLab}</td>
                                <td className="px-4 py-2 text-center">{grandCredit.toFixed(2)}</td>
                                <td className={`px-4 py-2 text-center ${overContactMax ? 'text-red-700' : ''}`}>
                                  {grandContact} / {CONTACT_HRS_MAX}{overContactMax && ' ⚠'}
                                </td>
                                <td colSpan={3}></td>
                              </tr>
                            </>
                          )}
                        </tfoot>
                      </table>
                    </div>
                    {!isUnassigned && (
                      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Other Loads</p>
                          {overMax && (
                            <span className="text-xs font-bold text-red-700">
                              {grandCredit.toFixed(2)} / {MAX_UNITS} unit credit — over the maximum load
                            </span>
                          )}
                        </div>
                        {instructorLoads.length === 0 ? (
                          <p className="text-xs text-gray-400">No administrative, research, extension, project, consultation, or lesson preparation load added yet.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {instructorLoads.map(l => {
                              const isHoursOnly = HOURS_ONLY_TYPES.has(l.load_type)
                              return (
                                <div key={l.id} className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs">
                                  <div className="min-w-0">
                                    {isHoursOnly ? (
                                      <span className="font-semibold text-gray-700">{LOAD_TYPE_LABEL[l.load_type]}</span>
                                    ) : (
                                      <>
                                        <span className="font-semibold text-gray-700">{LOAD_TYPE_LABEL[l.load_type] || 'Administrative Load'}:</span>{' '}
                                        <span className="text-gray-600">{l.description}</span>
                                      </>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-bold text-blue-600">
                                      {isHoursOnly ? `${l.hours} hrs/week` : `${l.units} units`}
                                    </span>
                                    <button onClick={()=>handleRemoveLoad(l.id)}
                                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {editEntry && (
        <AddEntryModal year={loadYear} semester={loadSem} prospectusSubjects={prospectusSubjects}
          onSave={handleEditEntry} onClose={()=>setEditEntry(null)} editEntry={editEntry} />
      )}
      {showPrint && (
        <PrintView entries={entries} adminLoads={adminLoads}
          year={loadYear} semester={loadSem} onClose={()=>setShowPrint(false)} />
      )}
      {showCourseOffering && (
        <CourseOfferingView entries={entries} year={loadYear} semester={loadSem}
          dept={user?.department} onClose={()=>setShowCourseOffering(false)} />
      )}

      {/* Assign from Unassigned modal */}
      {assignTarget && (() => {
        const unassignedEntries = entries.filter(e => !e.assigned_instructor_id)
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 bg-green-800 rounded-t-2xl">
                <div>
                  <p className="text-white font-bold">Assign Subject to {assignTarget.instructorName}</p>
                  <p className="text-green-300 text-xs mt-0.5">Pick from the currently unassigned subjects</p>
                </div>
                <button onClick={()=>setAssignTarget(null)} className="text-green-300 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-5">
                {unassignedEntries.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No unassigned subjects right now.</p>
                ) : (
                  <div className="space-y-2">
                    {unassignedEntries.map(e => (
                      <div key={e.id} className="flex items-center justify-between gap-3 border border-gray-200 rounded-xl px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-green-800 font-mono">{e.course_code} <span className="text-gray-600 font-sans font-normal">— {e.descriptive_title}</span></p>
                          <p className="text-xs text-gray-400 mt-0.5">{e.program_yr_sec || 'No section set'} · {e.units} units · {e.lec_hours}L/{e.lab_hours}Lab</p>
                        </div>
                        <button
                          onClick={()=>handleAssignToInstructor(e, assignTarget.instructorId, assignTarget.instructorName)}
                          disabled={assigningId === e.id}
                          className="shrink-0 flex items-center gap-1.5 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
                          {assigningId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Plus className="w-3.5 h-3.5"/>}
                          Assign
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Sections per Year Level modal */}
      {showSectionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 bg-green-800 rounded-t-2xl">
              <div>
                <p className="text-white font-bold">Sections per Year Level</p>
                <p className="text-green-300 text-xs mt-0.5">e.g. 4 → Auto-Generate creates sections A, B, C, D per subject</p>
              </div>
              <button onClick={()=>setShowSectionModal(false)} className="text-green-300 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {[1,2,3,4].map(yr => (
                <div key={yr} className={`flex items-center justify-between rounded-xl border-2 px-4 py-2.5 ${YEAR_COLORS[yr]}`}>
                  <span className="font-bold text-sm">{YEAR_LABEL[yr]}</span>
                  <input
                    type="number" min="1" max="26"
                    value={draftSectionCounts[yr]}
                    onChange={e=>setDraftSectionCounts(d=>({...d,[yr]:e.target.value}))}
                    placeholder="1"
                    className="w-20 border-2 border-white bg-white rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none focus:border-green-500"
                  />
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-1">
                Leave a year level blank to keep the old behavior (one unlabeled entry per subject — you set the section manually).
              </p>
              <div className="flex gap-3 pt-2">
                <button onClick={saveSectionCounts} disabled={savingSections}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                  {savingSections ? <><Loader2 className="w-4 h-4 animate-spin"/>Saving...</> : 'Save'}
                </button>
                <button onClick={()=>setShowSectionModal(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
