import { useState, useEffect } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, ClipboardList, Clock } from 'lucide-react'
import { submissionsAPI } from '../../services/api.js'

const SEM_LABEL = { 1: '1st', 2: '2nd', 3: 'Summer' }

export default function InstructorConfirmLoad() {
  const [confirmations, setConfirmations] = useState([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [entries, setEntries]   = useState({})
  const [loadingEntries, setLoadingEntries] = useState(null)
  const [confirming, setConfirming] = useState(null)

  const fetchConfirmations = () => {
    setLoading(true)
    submissionsAPI.getMyConfirmations()
      .then(r => setConfirmations(r.data))
      .catch(() => toast.error('Failed to load your confirmations.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchConfirmations() }, [])

  const handleExpand = async (submissionId) => {
    if (expanded === submissionId) { setExpanded(null); return }
    setExpanded(submissionId)
    if (entries[submissionId]) return
    setLoadingEntries(submissionId)
    try {
      const r = await submissionsAPI.getMyEntries(submissionId)
      setEntries(e => ({ ...e, [submissionId]: r.data }))
    } catch {
      toast.error('Failed to load your entries.')
    } finally {
      setLoadingEntries(null)
    }
  }

  const handleConfirm = async (submissionId) => {
    setConfirming(submissionId)
    try {
      const r = await submissionsAPI.confirm(submissionId)
      toast.success(r.data.message)
      fetchConfirmations()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to confirm.')
    } finally {
      setConfirming(null)
    }
  }

  const pending   = confirmations.filter(c => !c.confirmed_at)
  const confirmed = confirmations.filter(c => c.confirmed_at)

  return (
    <div>
      <PageHeader
        title="Confirm My Faculty Load"
        subtitle="Review and confirm the courses your Program Chair has assigned to you before it moves on to the Dean."
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : confirmations.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
          <ClipboardList className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-semibold text-gray-500">No faculty load to confirm yet.</p>
          <p className="text-sm mt-1 text-gray-400">This appears once your Program Chair submits a faculty loading sheet with you on it.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Awaiting Your Confirmation ({pending.length})</h2>
              <div className="space-y-3">
                {pending.map(c => (
                  <ConfirmCard key={c.confirmation_id} c={c}
                    expanded={expanded === c.submission_id}
                    entries={entries[c.submission_id]}
                    loadingEntries={loadingEntries === c.submission_id}
                    confirming={confirming === c.submission_id}
                    onExpand={() => handleExpand(c.submission_id)}
                    onConfirm={() => handleConfirm(c.submission_id)}
                  />
                ))}
              </div>
            </div>
          )}

          {confirmed.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Already Confirmed ({confirmed.length})</h2>
              <div className="space-y-3">
                {confirmed.map(c => (
                  <ConfirmCard key={c.confirmation_id} c={c}
                    expanded={expanded === c.submission_id}
                    entries={entries[c.submission_id]}
                    loadingEntries={loadingEntries === c.submission_id}
                    confirming={false}
                    onExpand={() => handleExpand(c.submission_id)}
                    onConfirm={null}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ConfirmCard({ c, expanded, entries, loadingEntries, confirming, onExpand, onConfirm }) {
  const totalUnits = entries ? entries.reduce((a, e) => a + Number(e.units), 0) : 0
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 transition" onClick={onExpand}>
        <div>
          <p className="font-semibold text-gray-800">{c.chair_dept} — {c.chair_name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            AY {c.academic_year}, {SEM_LABEL[c.semester]} Semester
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${c.confirmed_at ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
            {c.confirmed_at ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
            {c.confirmed_at ? 'Confirmed' : 'Pending'}
          </span>
          {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5">
          {loadingEntries ? (
            <div className="flex items-center gap-2 py-4 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your courses...
            </div>
          ) : !entries || entries.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">No courses found for you on this submission.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100 mt-4 mb-4">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Course No.</th>
                    <th className="px-3 py-2 text-left">Descriptive Title</th>
                    <th className="px-3 py-2 text-left">Section</th>
                    <th className="px-3 py-2 text-center">Units</th>
                    <th className="px-3 py-2 text-center">Lec</th>
                    <th className="px-3 py-2 text-center">Lab</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map(e => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-green-800 font-semibold">{e.course_code}</td>
                      <td className="px-3 py-2 text-gray-600">{e.descriptive_title}</td>
                      <td className="px-3 py-2 text-gray-500">{e.program_yr_sec || '—'}</td>
                      <td className="px-3 py-2 text-center text-gray-600">{e.units}</td>
                      <td className="px-3 py-2 text-center text-gray-500">{e.lec_hours}</td>
                      <td className="px-3 py-2 text-center text-gray-500">{e.lab_hours}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-green-50 font-bold">
                    <td className="px-3 py-2" colSpan={3}>Total</td>
                    <td className="px-3 py-2 text-center">{totalUnits}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {onConfirm && (
            <button onClick={onConfirm} disabled={confirming}
              className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">
              {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm My Load
            </button>
          )}
          {c.confirmed_at && (
            <p className="text-xs text-gray-400 mt-2">Confirmed on {new Date(c.confirmed_at).toLocaleDateString()}</p>
          )}
        </div>
      )}
    </div>
  )
}
