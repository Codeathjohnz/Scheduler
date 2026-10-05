import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { facultyLoadAPI } from '../../services/api.js'
import { CheckCircle2, Clock, UserMinus, Loader2 } from 'lucide-react'

const SEM = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' }

/**
 * The chair's view of load confirmations for the term: who has confirmed,
 * who is still waiting to answer, and who hasn't been asked yet.
 */
export default function ChairConfirmations() {
  const [year, setYear]       = useState('2026-2027')
  const [semester, setSem]    = useState(1)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    facultyLoadAPI.confirmations(year, semester)
      .then(r => setData(r.data))
      .catch(() => toast.error('Could not load confirmations.'))
      .finally(() => setLoading(false))
  }, [year, semester])

  const group = (title, icon, cls, list, note) => (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className={`flex items-center justify-between px-5 py-3 border-b ${cls}`}>
        <div className="flex items-center gap-2 font-bold text-sm">{icon} {title}</div>
        <span className="text-xs font-bold">{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-400 text-center">None.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {list.map(i => (
            <li key={i.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-800">{i.name}</p>
                <p className="text-xs text-gray-500">{i.department || '—'}</p>
              </div>
              {i.confirmed_at && <p className="text-xs text-gray-500">Confirmed {new Date(i.confirmed_at).toLocaleString()}</p>}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-100">{note}</p>}
    </section>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Load Confirmations"
        subtitle="Who has confirmed their load for the term, who is still to answer, and who hasn't been asked yet."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Academic year</label>
          <input value={year} onChange={e => setYear(e.target.value)}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 w-40" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
          <select value={semester} onChange={e => setSem(Number(e.target.value))}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-green-500">
            {Object.entries(SEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {group('Confirmed', <CheckCircle2 className="w-4 h-4 text-green-700" />, 'bg-green-50 border-green-200 text-green-800', data.confirmed)}
          {group('Waiting to confirm', <Clock className="w-4 h-4 text-amber-700" />, 'bg-amber-50 border-amber-200 text-amber-800', data.pending,
            'These have a request out and haven’t answered yet.')}
          {group('Not asked yet', <UserMinus className="w-4 h-4 text-gray-600" />, 'bg-gray-50 border-gray-200 text-gray-700', data.not_asked,
            'Assigned in Faculty Load, but not yet on a submitted load.')}
        </div>
      )}
    </div>
  )
}
