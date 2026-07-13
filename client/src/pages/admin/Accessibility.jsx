import { useState, useEffect } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { CheckCircle, XCircle, Loader2, Accessibility } from 'lucide-react'
import { accessibilityAPI } from '../../services/api.js'

const LEVEL_INFO = {
  1: { label: 'Level 1 – High Priority', color: 'bg-red-100 text-red-700 border-red-200',    desc: 'Wheelchair user / cannot use stairs → Ground floor only' },
  2: { label: 'Level 2 – Medium Priority', color: 'bg-amber-100 text-amber-700 border-amber-200', desc: 'Limited mobility / difficulty with stairs → Prefer lower floors' },
  3: { label: 'Level 3 – Low Priority', color: 'bg-green-100 text-green-700 border-green-200', desc: 'Fully mobile / no restrictions → Any room' },
}

const STATUS_STYLE = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function AdminAccessibility() {
  const [requests, setRequests]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [levelSelect, setLevelSelect] = useState({})
  const [acting, setActing]         = useState(null)

  const fetchRequests = () => {
    setLoading(true)
    accessibilityAPI.getAll()
      .then(r => setRequests(r.data))
      .catch(() => toast.error('Failed to load accessibility requests.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchRequests() }, [])

  const handleApprove = async (id) => {
    const level = levelSelect[id]
    if (!level) { toast.error('Please assign a mobility level before approving.'); return }
    setActing(id)
    try {
      await accessibilityAPI.review(id, 'approve', Number(level))
      toast.success(`Request approved with ${LEVEL_INFO[level].label}.`)
      fetchRequests()
    } catch {
      toast.error('Failed to approve request.')
    } finally {
      setActing(null)
    }
  }

  const handleReject = async (id) => {
    setActing(id)
    try {
      await accessibilityAPI.review(id, 'reject', null)
      toast.success('Accessibility request rejected.')
      fetchRequests()
    } catch {
      toast.error('Failed to reject request.')
    } finally {
      setActing(null)
    }
  }

  const pending  = requests.filter(r => r.status === 'pending')
  const reviewed = requests.filter(r => r.status !== 'pending')

  return (
    <div>
      <PageHeader
        title="Accessibility Requests"
        subtitle="Review and classify instructor accessibility requests for AI room assignment."
      />

      {/* Level legend */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {Object.entries(LEVEL_INFO).map(([lvl, info]) => (
          <div key={lvl} className={`rounded-xl border p-4 ${info.color}`}>
            <p className="font-semibold text-sm">{info.label}</p>
            <p className="text-xs mt-1 opacity-80">{info.desc}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading requests...
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
          <Accessibility className="w-12 h-12 mb-3 opacity-20" />
          <p className="font-semibold text-gray-500">No accessibility requests yet.</p>
          <p className="text-sm mt-1">Instructors can submit requests from their portal.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Pending Review ({pending.length})
              </h2>
              <div className="space-y-4">
                {pending.map(req => (
                  <RequestCard
                    key={req.id}
                    req={req}
                    levelSelect={levelSelect[req.id] || ''}
                    onLevelChange={val => setLevelSelect(s => ({ ...s, [req.id]: val }))}
                    acting={acting === req.id}
                    onApprove={() => handleApprove(req.id)}
                    onReject={() => handleReject(req.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {reviewed.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Previously Reviewed ({reviewed.length})
              </h2>
              <div className="space-y-4">
                {reviewed.map(req => (
                  <RequestCard key={req.id} req={req} acting={false} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RequestCard({ req, levelSelect, onLevelChange, acting, onApprove, onReject }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-800">{req.instructor_name}</p>
          <p className="text-sm text-gray-600 mt-0.5">"{req.reason}"</p>
          {req.details && <p className="text-xs text-gray-400 mt-1">Note: {req.details}</p>}
          <p className="text-xs text-gray-400 mt-1">
            Submitted {new Date(req.created_at).toLocaleDateString()}
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ml-4 capitalize ${STATUS_STYLE[req.status] || 'bg-gray-100 text-gray-600'}`}>
          {req.status}
        </span>
      </div>

      {req.status === 'pending' && onApprove && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Assign Mobility Level</label>
            <select
              value={levelSelect}
              onChange={e => onLevelChange(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
            >
              <option value="">Select level...</option>
              <option value="1">Level 1 – High Priority (wheelchair)</option>
              <option value="2">Level 2 – Medium Priority (stairs difficulty)</option>
              <option value="3">Level 3 – Low Priority (no restriction)</option>
            </select>
          </div>
          <button
            onClick={onApprove}
            disabled={acting}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-lg transition mt-4"
          >
            {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Approve
          </button>
          <button
            onClick={onReject}
            disabled={acting}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-lg transition mt-4"
          >
            {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Reject
          </button>
        </div>
      )}

      {req.status === 'approved' && req.mobility_level && (
        <div className={`mt-3 pt-3 border-t border-gray-100 text-sm px-3 py-2 rounded-lg ${LEVEL_INFO[req.mobility_level]?.color}`}>
          Assigned: {LEVEL_INFO[req.mobility_level]?.label} — {LEVEL_INFO[req.mobility_level]?.desc}
          {req.reviewed_at && (
            <span className="ml-2 text-xs opacity-60">· {new Date(req.reviewed_at).toLocaleDateString()}</span>
          )}
        </div>
      )}
    </div>
  )
}
