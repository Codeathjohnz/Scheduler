import { useState, useEffect } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { facultyLoadAPI } from '../../services/api.js'
import toast from 'react-hot-toast'
import { Loader2, ClipboardList, Printer } from 'lucide-react'

const SEM_LABEL = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' }

function unitCredit(lec, lab) { return Number(lec || 0) + Number(lab || 0) * 0.75 }
// NSTP does not count toward the unit-credit load — same convention as the
// Faculty Loading Sheet (facultyLoadingDocx.js) and Faculty Load page. It
// still lists below; it's just excluded from the totals.
function isNstp(code) { return /^NSTP\b/i.test(String(code || '').trim()) }

export default function InstructorMyLoad() {
  const [year, setYear]         = useState('2026-2027')
  const [semester, setSemester] = useState(1)
  const [entries, setEntries]   = useState([])
  const [adminLoads, setAdminLoads] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    facultyLoadAPI.getMyLoad(year, semester)
      .then(r => { setEntries(r.data.entries); setAdminLoads(r.data.adminLoads) })
      .catch(() => toast.error('Failed to load your faculty load.'))
      .finally(() => setLoading(false))
  }, [year, semester])

  const loadEntries = entries.filter(e => !isNstp(e.course_code))
  const totalUnits   = loadEntries.reduce((a, e) => a + Number(e.units), 0)
  const totalLec     = loadEntries.reduce((a, e) => a + Number(e.lec_hours), 0)
  const totalLab     = loadEntries.reduce((a, e) => a + Number(e.lab_hours), 0)
  const totalCredit  = loadEntries.reduce((a, e) => a + unitCredit(e.lec_hours, e.lab_hours), 0)
  const totalOther   = adminLoads.reduce((a, l) => a + Number(l.units), 0)
  const grandCredit  = totalCredit + totalOther

  // Group entries by which chair/department assigned them — an instructor
  // teaching for more than one program (e.g. both a BSIT and a BSIS chair
  // in CCIS) sees every one of them here, not just one.
  const byChair = {}
  for (const e of entries) {
    const key = e.chair_dept || e.chair_name || '—'
    if (!byChair[key]) byChair[key] = []
    byChair[key].push(e)
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1 print:hidden">
        <PageHeader
          title="My Individual Faculty Load"
          subtitle="Every subject currently assigned to you, across every Program Chair you teach for."
        />
        <button onClick={() => window.print()}
          className="flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-green-900 font-bold px-4 py-1.5 rounded-lg transition text-sm shrink-0">
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-5 print:hidden">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
          <input value={year} onChange={e => setYear(e.target.value)}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 w-32" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
          <select value={semester} onChange={e => setSemester(Number(e.target.value))}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 bg-white">
            <option value={1}>1st Semester</option>
            <option value={2}>2nd Semester</option>
            <option value={3}>Summer</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : entries.length === 0 && adminLoads.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
          <ClipboardList className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-semibold text-gray-500">No load assigned yet for {SEM_LABEL[semester]}, A.Y. {year}.</p>
          <p className="text-sm mt-1 text-gray-400">This appears once a Program Chair assigns you a subject.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-bold text-gray-700">{SEM_LABEL[semester]}, A.Y. {year}</p>
          </div>

          {Object.entries(byChair).map(([dept, rows]) => (
            <div key={dept} className="px-5 py-4 border-b border-gray-100 last:border-0">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{dept}</p>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Course No.</th>
                      <th className="px-3 py-2 text-left">Descriptive Title</th>
                      <th className="px-3 py-2 text-left">Section</th>
                      <th className="px-3 py-2 text-center">Units</th>
                      <th className="px-3 py-2 text-center">Lec</th>
                      <th className="px-3 py-2 text-center">Lab</th>
                      <th className="px-3 py-2 text-center">Unit Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-green-800 font-semibold">{e.course_code}</td>
                        <td className="px-3 py-2 text-gray-600">{e.descriptive_title}</td>
                        <td className="px-3 py-2 text-gray-500">{e.program_yr_sec || '—'}</td>
                        <td className="px-3 py-2 text-center text-gray-600">{e.units}</td>
                        <td className="px-3 py-2 text-center text-gray-500">{e.lec_hours}</td>
                        <td className="px-3 py-2 text-center text-gray-500">{e.lab_hours}</td>
                        <td className="px-3 py-2 text-center text-gray-500">
                          {isNstp(e.course_code)
                            ? <span title="NSTP does not count toward unit-credit load">{unitCredit(e.lec_hours, e.lab_hours).toFixed(2)} *</span>
                            : unitCredit(e.lec_hours, e.lab_hours).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {adminLoads.length > 0 && (
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Other Load (Administrative / Research / Extension / Project)</p>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-center">Units</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {adminLoads.map(l => (
                      <tr key={l.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-600">{l.description}</td>
                        <td className="px-3 py-2 text-center text-gray-600">{l.units}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="px-5 py-4 bg-green-50 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              {entries.some(e => isNstp(e.course_code)) && '* NSTP is listed but does not count toward the unit-credit total.'}
            </p>
            <p className="text-sm font-bold text-green-900">
              Total Unit Credit: {grandCredit.toFixed(2)}
              {totalOther > 0 && <span className="font-normal text-gray-500"> ({totalCredit.toFixed(2)} teaching + {totalOther} other)</span>}
              <span className="font-normal text-gray-500"> · {totalUnits} units · {totalLec}L/{totalLab}Lab</span>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
