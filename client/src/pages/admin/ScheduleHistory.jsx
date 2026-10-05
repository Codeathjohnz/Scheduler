import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { schedulingAPI } from '../../services/api.js'
import { History, Loader2 } from 'lucide-react'

const SEM = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' }

/**
 * Transaction history: every published schedule, department by department, so
 * the registrar can see which departments are already finished for each term.
 */
export default function ScheduleHistory() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)

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
