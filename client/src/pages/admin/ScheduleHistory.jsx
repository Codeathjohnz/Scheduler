import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { schedulingAPI } from '../../services/api.js'
import { History, Loader2, Building2, Users } from 'lucide-react'
import ScheduleGroups from '../../components/common/ScheduleGroups.jsx'

const SEM = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' }

/**
 * Transaction history: every published schedule, department by department, so
 * the registrar can see which departments are already finished for each term.
 */
export default function ScheduleHistory() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  // Existing schedules, for reference: which rooms and times are already taken.
  const [viewYear, setViewYear] = useState('2026-2027')
  const [viewSem, setViewSem]   = useState(1)
  const [viewMode, setViewMode] = useState('building')
  const [schedRows, setSchedRows] = useState([])
  const [schedLoading, setSchedLoading] = useState(false)

  useEffect(() => {
    setSchedLoading(true)
    schedulingAPI.getAll(viewYear, viewSem)
      .then(r => setSchedRows(r.data.schedules || []))
      .catch(() => { setSchedRows([]); toast.error('Could not load the schedules for that term.') })
      .finally(() => setSchedLoading(false))
  }, [viewYear, viewSem])

  useEffect(() => {
    schedulingAPI.history()
      .then(r => setRows(r.data))
      .catch(() => toast.error('Could not load the transaction history.'))
      .finally(() => setLoading(false))
  }, [])

  // Group by term, newest first; within a term, departments in publish order.
  const terms = []
  for (const r of rows) {
    const key = `${r.academic_year}|${r.semester}`
    let t = terms.find(x => x.key === key)
    if (!t) { t = { key, year: r.academic_year, semester: r.semester, published_at: r.published_at, by: r.published_by_name, depts: [] }; terms.push(t) }
    t.depts.push(r)
  }

  return (
    <div>
      <PageHeader
        title="Transaction History"
        subtitle="Published schedules, by term and department. A published term is final."
      />

      <section className="mb-8">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-2">Schedules in the system</h2>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Academic year</label>
            <input value={viewYear} onChange={e => setViewYear(e.target.value)}
              className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 w-40" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
            <select value={viewSem} onChange={e => setViewSem(Number(e.target.value))}
              className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-green-500">
              {Object.entries(SEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="ml-auto flex border-2 border-gray-200 rounded-xl overflow-hidden">
            <button onClick={() => setViewMode('building')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold ${viewMode === 'building' ? 'bg-green-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              <Building2 className="w-3.5 h-3.5" /> By building
            </button>
            <button onClick={() => setViewMode('instructor')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold ${viewMode === 'instructor' ? 'bg-green-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              <Users className="w-3.5 h-3.5" /> By instructor
            </button>
          </div>
        </div>
        {schedLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : schedRows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 py-12 text-center text-sm text-gray-400">No schedule exists for this term yet.</div>
        ) : (
          <ScheduleGroups rows={schedRows} mode={viewMode} />
        )}
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…</div>
      ) : terms.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-24 text-gray-400">
          <History className="w-14 h-14 mb-4 opacity-20" />
          <p className="font-semibold text-gray-500">Nothing published yet.</p>
          <p className="text-sm mt-1">Published schedules appear here, department by department.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {terms.map(t => (
            <div key={t.key} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 bg-green-800 text-white">
                <p className="font-bold">{SEM[t.semester] || `Semester ${t.semester}`} · A.Y. {t.year}</p>
                <p className="text-xs text-green-200">
                  Published {new Date(t.published_at).toLocaleString()}{t.by ? ` by ${t.by}` : ''}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['Department', 'Subjects', 'Sessions', 'Published by'].map(h => (
                      <th key={h} className="px-5 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {t.depts.map(d => (
                    <tr key={d.id}>
                      <td className="px-5 py-2.5 font-semibold text-gray-800">{d.department}</td>
                      <td className="px-5 py-2.5 text-gray-600">{d.subjects}</td>
                      <td className="px-5 py-2.5 text-gray-600">{d.sessions}</td>
                      <td className="px-5 py-2.5 text-gray-500">{d.published_by_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
