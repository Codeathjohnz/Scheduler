import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { facultyLoadAPI, submissionsAPI } from '../../services/api.js'
import { CheckCircle2, Clock, UserMinus, Loader2, Circle, XCircle } from 'lucide-react'

const SEM = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' }

// The approval chain after instructors — in order. 'actionField' is the
// timestamp column stamped when that stage acts.
const CHAIN_STAGES = [
  { key: 'dean',      label: 'Dean',             actionField: 'dean_action_at' },
  { key: 'chief_cpd', label: 'Chief CPD',         actionField: 'chief_cpd_action_at' },
  { key: 'qa',        label: 'Quality Assurance', actionField: 'qa_action_at' },
  { key: 'vpaa',      label: 'VPAA',              actionField: 'vpaa_action_at' },
  { key: 'admin',     label: 'Admin',             actionField: null },
]
const WAITING_ON = {
  pending_dean: 'dean', pending_chief_cpd: 'chief_cpd',
  pending_qa: 'qa', pending_vpaa: 'vpaa', pending_admin: 'admin',
}
// Where the chain currently sits: everything before this index is already
// confirmed, this index is either "waiting" or "returned here", and
// everything after is "not reached yet". 'returned' freezes it at whichever
// stage sent it back rather than wherever status normally implies.
function chainPosition(termStatus) {
  const indexOf = (key) => CHAIN_STAGES.findIndex(s => s.key === key)
  if (termStatus.status === 'returned') return indexOf(termStatus.returned_stage)
  if (termStatus.status === 'validated' || termStatus.status === 'scheduled') return CHAIN_STAGES.length
  const waitingKey = WAITING_ON[termStatus.status]
  return waitingKey ? indexOf(waitingKey) : -1
}

/**
 * The chair's view of load confirmations for the term: who has confirmed,
 * who is still waiting to answer, and who hasn't been asked yet.
 */
export default function ChairConfirmations() {
  const [year, setYear]       = useState('2026-2027')
  const [semester, setSem]    = useState(1)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  // The submission's progress past the instructors: Dean, Chief CPD, Quality
  // Assurance, VPAA, Admin — null means nothing's been submitted yet.
  const [termStatus, setTermStatus] = useState(null)

  useEffect(() => {
    setLoading(true)
    facultyLoadAPI.confirmations(year, semester)
      .then(r => setData(r.data))
      .catch(() => toast.error('Could not load confirmations.'))
      .finally(() => setLoading(false))
    submissionsAPI.getMyTermStatus(year, semester)
      .then(r => setTermStatus(r.data))
      .catch(() => setTermStatus(null))
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

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : (
      <>
        {/* ── Approval chain: Dean, Chief CPD, Quality Assurance, VPAA, Admin ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
            <p className="font-bold text-sm text-gray-800">Approval Chain</p>
            <p className="text-xs text-gray-500">What happens after every instructor confirms — in order.</p>
          </div>
          {!termStatus ? (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">Nothing submitted for this term yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {CHAIN_STAGES.map((stage, idx) => {
                const pos = chainPosition(termStatus)
                const returnedHere = termStatus.status === 'returned' && idx === pos
                const passed = idx < pos
                const waitingHere = termStatus.status !== 'returned' && idx === pos
                const actedAt = stage.actionField && termStatus[stage.actionField]

                let icon, text, textCls
                if (returnedHere) {
                  icon = <XCircle className="w-4 h-4 text-red-600" />
                  text = `Returned this for revision${actedAt ? ` · ${new Date(actedAt).toLocaleString()}` : ''}`
                  textCls = 'text-red-700'
                } else if (passed) {
                  icon = <CheckCircle2 className="w-4 h-4 text-green-700" />
                  text = actedAt ? `Confirmed ${new Date(actedAt).toLocaleString()}` : 'Confirmed'
                  textCls = 'text-gray-500'
                } else if (waitingHere) {
                  icon = <Clock className="w-4 h-4 text-amber-700" />
                  text = 'Waiting on them now'
                  textCls = 'text-amber-700 font-semibold'
                } else {
                  icon = <Circle className="w-4 h-4 text-gray-300" />
                  text = 'Not reached yet'
                  textCls = 'text-gray-400'
                }

                return (
                  <li key={stage.key} className="px-5 py-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      {icon}
                      <span className="text-sm font-semibold text-gray-800">{stage.label}</span>
                    </div>
                    <span className={`text-xs ${textCls}`}>{text}</span>
                  </li>
                )
              })}
            </ul>
          )}
          {termStatus?.status === 'returned' && termStatus.return_reason && (
            <p className="px-5 py-3 text-sm text-red-700 bg-red-50 border-t border-red-100">“{termStatus.return_reason}”</p>
          )}
        </section>

        {data && (
          <div className="grid gap-5 lg:grid-cols-3">
            {group('Confirmed', <CheckCircle2 className="w-4 h-4 text-green-700" />, 'bg-green-50 border-green-200 text-green-800', data.confirmed)}
            {group('Waiting to confirm', <Clock className="w-4 h-4 text-amber-700" />, 'bg-amber-50 border-amber-200 text-amber-800', data.pending,
              'These have a request out and haven’t answered yet.')}
            {group('Not asked yet', <UserMinus className="w-4 h-4 text-gray-600" />, 'bg-gray-50 border-gray-200 text-gray-700', data.not_asked,
              'Assigned in Faculty Load, but not yet on a submitted load.')}
          </div>
        )}
      </>
      )}
    </div>
  )
}
