import { Fragment, useState } from 'react'
import { creditOf } from '../../utils/unitCredit.js'
import { collegeFullName, programCodesOf } from '../../utils/collegeNames.js'
import { X, Printer, Loader2 } from 'lucide-react'

const SEM_LABEL = { 1: '1st', 2: '2nd', 3: 'Summer' }

const LOAD_TYPES = [
  { key: 'administrative', label: 'Administrative Load' },
  { key: 'research',       label: 'Research Load' },
  { key: 'extension',      label: 'Extension Load' },
  { key: 'project',        label: 'Project Load' },
  { key: 'consultation',   label: 'Consultation', hoursOnly: true },
  { key: 'lesson_prep',    label: 'Lesson Preparation', hoursOnly: true },
]
const HOURS_ONLY_TYPES = new Set(LOAD_TYPES.filter(t => t.hoursOnly).map(t => t.key))

function isNstp(code) { return /^NSTP\b/i.test(String(code || '').trim()) }
function contactHours(lec, lab) { return Number(lec) + Number(lab) }

const th = { border: '1px solid #999', padding: '4px 6px', textAlign: 'center', fontWeight: 'bold', fontSize: '9pt', verticalAlign: 'middle' }
const td = { border: '1px solid #ccc', padding: '3px 5px', fontSize: '9pt', verticalAlign: 'middle' }

/**
 * The same Faculty Loading Sheet layout the chair sees when printing their
 * own load (client/src/pages/chair/FacultyLoad.jsx's PrintView) — reused
 * read-only wherever a reviewer (Admin's Validate Data, Dean, Chief CPD, QA,
 * VPAA) needs to look at a submission the way it's actually going to be
 * recorded, instead of a plain flat table. College name is looked up from
 * `collegeDept` (falls back to the code itself if not in the mapping);
 * the program line lists every program code the entries actually contain,
 * since one chair's load can span more than one program (e.g. CCIS runs
 * both BSIT and BSIS).
 */
export default function FacultyLoadingSheet({ entries, adminLoads = [], year, semester, collegeDept, chairName, onClose }) {
  const instructorMap = {}
  for (const e of entries) {
    const key = e.assigned_instructor_id || '__unassigned__'
    const name = e.instructor_name || '— Unassigned —'
    if (!instructorMap[key]) instructorMap[key] = { name, subjects: [] }
    instructorMap[key].subjects.push(e)
  }
  const instructors = Object.values(instructorMap)
  const semLabel = SEM_LABEL[semester] || semester
  const collegeName = collegeFullName(collegeDept)
  const programLine = programCodesOf(entries).join(' / ') || collegeDept || ''

  const [printing, setPrinting] = useState(false)
  const handlePrint = () => { setPrinting(true); window.print(); setTimeout(() => setPrinting(false), 500) }

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-auto">
      <div className="print:hidden sticky top-0 bg-green-800 text-white flex items-center gap-4 px-6 py-3 shadow z-10">
        <button onClick={onClose} className="flex items-center gap-2 hover:text-amber-400 transition text-sm">
          <X className="w-4 h-4" /> Close Preview
        </button>
        <span className="text-green-300 text-sm">|</span>
        <span className="text-sm font-semibold">Faculty Loading Sheet — AY {year} {semLabel} Semester{chairName ? ` — ${chairName}` : ''}</span>
        <button onClick={handlePrint}
          className="ml-auto flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-green-900 font-bold px-4 py-1.5 rounded-lg transition text-sm">
          {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Print
        </button>
      </div>

      <div className="p-6 print:p-0">
        {instructors.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No entries to show.</p>
        ) : instructors.map((inst, idx) => {
          const subs = inst.subjects
          const loadSubs     = subs.filter(s => !isNstp(s.course_code))
          const totalUnits   = loadSubs.reduce((a, s) => a + Number(s.units), 0)
          const totalLec     = loadSubs.reduce((a, s) => a + Number(s.lec_hours), 0)
          const totalLab     = loadSubs.reduce((a, s) => a + Number(s.lab_hours), 0)
          const totalCredit  = loadSubs.reduce((a, s) => a + creditOf(s), 0)
          const totalContact = loadSubs.reduce((a, s) => a + contactHours(s.lec_hours, s.lab_hours), 0)

          const instId = subs[0]?.assigned_instructor_id
          const instructorLoads = adminLoads.filter(a => a.instructor_id === instId)
          const loadSections = LOAD_TYPES.map(lt => {
            const rows  = instructorLoads.filter(a => (a.load_type || 'administrative') === lt.key)
            const total = rows.reduce((a, r) => a + Number(r.units), 0)
            return { ...lt, rows, total }
          })
          const totalOtherLoads = loadSections.reduce((a, s) => a + s.total, 0)
          const totalHoursOnly = instructorLoads
            .filter(a => HOURS_ONLY_TYPES.has(a.load_type))
            .reduce((a, r) => a + Number(r.hours || 0), 0)

          const grandUnits   = totalUnits   + totalOtherLoads
          const grandLec     = totalLec
          const grandLab     = totalLab
          const grandCredit  = totalCredit  + totalOtherLoads
          const grandContact = totalContact + totalHoursOnly

          return (
            <div key={idx} className="mb-8 print:mb-0 print:page-break-after-always">
              <style>{`@media print { .instructor-block { page-break-after: always; } }`}</style>
              <div className="instructor-block border border-gray-400 print:border-black" style={{ fontFamily: 'Arial,sans-serif', fontSize: '10pt' }}>
                <div style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #999' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '11pt' }}>{collegeName}</div>
                  {programLine && <div style={{ fontWeight: 'bold' }}>{programLine}</div>}
                  <div style={{ marginTop: '4px' }}>
                    Semester: <strong>{semLabel}</strong>&nbsp;&nbsp;&nbsp;Academic Year: <strong>{year}</strong>
                  </div>
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5' }}>
                      <th style={th} rowSpan={2}>Name of Instructor<br/>(LN, FN, MI)</th>
                      <th style={th} rowSpan={2}>Course No.</th>
                      <th style={th} rowSpan={2}>Descriptive Title</th>
                      <th style={th} rowSpan={2}>Program/<br/>Yr/Sec</th>
                      <th style={th} rowSpan={2}>No. of<br/>Units</th>
                      <th style={{ ...th, textAlign: 'center' }} colSpan={2}>No. of Hour/Week</th>
                      <th style={th} rowSpan={2}>Unit<br/>Credit</th>
                      <th style={th} rowSpan={2}>Contact<br/>Hours</th>
                      <th style={th} rowSpan={2}>Lab Room<br/>to be used</th>
                    </tr>
                    <tr style={{ background: '#f5f5f5' }}>
                      <th style={th}>Lec</th>
                      <th style={th}>Lab</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s, si) => (
                      <tr key={s.id}>
                        <td style={{ ...td, fontWeight: si === 0 ? 'bold' : 'normal' }}>
                          {si === 0 ? inst.name.toUpperCase() : ''}
                        </td>
                        <td style={td}>{s.course_code}</td>
                        <td style={td}>{s.descriptive_title}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{s.program_yr_sec}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{s.units}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{s.lec_hours}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{s.lab_hours}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{creditOf(s).toFixed(2)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{contactHours(s.lec_hours, s.lab_hours)}</td>
                        <td style={td}>{s.room || ''}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                      <td style={{ ...td }} colSpan={4}>Total Academic Load</td>
                      <td style={{ ...td, textAlign: 'center' }}>{totalUnits}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{totalLec}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{totalLab}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{totalCredit.toFixed(2)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{totalContact}</td>
                      <td style={td}></td>
                    </tr>

                    {loadSections.map(sec => {
                      const isHoursOnlySection = HOURS_ONLY_TYPES.has(sec.key)
                      const totalHours = isHoursOnlySection ? sec.rows.reduce((a, r) => a + Number(r.hours || 0), 0) : 0
                      return (
                        <Fragment key={sec.key}>
                          <tr><td style={{ ...td, fontWeight: 'bold', background: '#fafafa' }} colSpan={10}>{sec.label}</td></tr>
                          {sec.rows.length > 0 ? sec.rows.map(a => (
                            <tr key={a.id}>
                              <td style={td}></td>
                              <td style={td} colSpan={2}>{isHoursOnlySection ? sec.label : a.description}</td>
                              <td style={td}></td>
                              <td style={{ ...td, textAlign: 'center' }}>{isHoursOnlySection ? `${a.hours} hrs` : a.units}</td>
                              <td style={{ ...td, textAlign: 'center' }}></td>
                              <td style={{ ...td, textAlign: 'center' }}></td>
                              <td style={{ ...td, textAlign: 'center' }}>{isHoursOnlySection ? '' : Number(a.units).toFixed(2)}</td>
                              <td style={{ ...td, textAlign: 'center' }}></td>
                              <td style={td}></td>
                            </tr>
                          )) : (
                            <tr><td style={{ ...td, height: '24px' }} colSpan={10}></td></tr>
                          )}
                          <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                            <td style={td} colSpan={4}>Total {sec.label}</td>
                            <td style={{ ...td, textAlign: 'center' }}>{isHoursOnlySection ? (totalHours ? `${totalHours} hrs` : '') : (sec.total || '')}</td>
                            <td style={{ ...td, textAlign: 'center' }}></td>
                            <td style={{ ...td, textAlign: 'center' }}></td>
                            <td style={{ ...td, textAlign: 'center' }}>{isHoursOnlySection ? '' : (sec.total ? sec.total.toFixed(2) : '')}</td>
                            <td style={{ ...td, textAlign: 'center' }}></td>
                            <td style={td}></td>
                          </tr>
                        </Fragment>
                      )
                    })}

                    <tr style={{ background: '#e8e8e8', fontWeight: 'bold' }}>
                      <td style={td} colSpan={4}>Total Load</td>
                      <td style={{ ...td, textAlign: 'center' }}>{grandUnits}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{grandLec}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{grandLab}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{grandCredit.toFixed(2)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{grandContact}</td>
                      <td style={td}></td>
                    </tr>
                  </tbody>
                </table>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', padding: '16px 12px', borderTop: '1px solid #999', fontSize: '9pt' }}>
                  {[
                    { label: 'Prepared by:', role: `Chairperson, ${programLine || collegeDept || ''}` },
                    { label: 'Checked by:', role: `Dean, ${collegeDept || ''}` },
                    { label: 'Reviewed by:', role: 'Chief Curriculum Planning and Development' },
                    { label: 'Approved by:', role: 'Vice President for Academic Affairs and Quality Assurance' },
                  ].map((s, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{s.label}</div>
                      <div style={{ marginTop: '36px', borderTop: '1px solid #333', paddingTop: '4px' }}>&nbsp;</div>
                      <div style={{ fontSize: '8pt', color: '#555' }}>{s.role}</div>
                      <div style={{ marginTop: '12px', fontSize: '8pt' }}>Date: ___________</div>
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
