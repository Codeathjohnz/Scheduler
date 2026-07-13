import { useState, useEffect } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { CheckCircle2, XCircle, Loader2, Briefcase } from 'lucide-react'
import { loadRequestAPI } from '../../services/api.js'

const LOAD_TYPE_LABEL = {
  administrative: 'Administrative Load',
  research:       'Research Load',
  extension:      'Extension Load',
  project:        'Project Load',
  consultation:   'Consultation',
  lesson_prep:    'Lesson Preparation',
}
const HOURS_ONLY_TYPES = new Set(['consultation', 'lesson_prep'])

const STATUS_STYLE = {
  pending:  'bg-amber-100 text-amber-800 border border-amber-200',
  approved: 'bg-green-100 text-green-800 border border-green-200',
  rejected: 'bg-red-100 text-red-700 border border-red-200',
}

export default function ChairLoadRequests() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [acting, setActing]     = useState(null)

  const fetchRequests = () => {
    setLoading(true)
    loadRequestAPI.getAll()
      .then(r => setRequests(r.data))
      .catch(() => toast.error('Failed to load requests.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchRequests() }, [])

  const handleAction = async (id, action) => {
    setActing(id)
    try {
      await loadRequestAPI.review(id, action)
      toast.success(
        action === 'approve'
          ? 'Load request approved and added to the faculty loading sheet.'
          : 'Load request rejected.'
      )
      fetchRequests()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed. Please try again.')
    } finally {
      setActing(null)
    }
  }

  const pending  = requests.filter(r => r.status === 'pending')
  const reviewed = requests.filter(r => r.status !== 'pending')

  return (
    <div>
      <PageHeader
        title="Load Requests"
        subtitle="Review administrative, research, extension, project, consultation, and lesson preparation load submitted by your instructors."
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading requests...
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
          <Briefcase className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-semibold text-gray-500">No load requests yet.</p>
          <p className="text-sm mt-1 text-gray-400">Instructors submit these from their Load Request page.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Awaiting Review ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map(r => (
                  <RequestCard key={r.id} r={r} acting={acting === r.id} onAction={(action) => handleAction(r.id, action)} />
                ))}
              </div>
            </div>
          )}

          {reviewed.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Previously Reviewed ({reviewed.length})
              </h2>
              <div className="space-y-3">
                {reviewed.map(r => (
                  <RequestCard key={r.id} r={r} acting={false} onAction={null} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RequestCard({ r, acting, onAction }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="font-semibold text-gray-800">
          {r.instructor_name} <span className="text-gray-400 font-normal">· {r.instructor_dept || '—'}</span>
        </p>
        <p className="text-sm text-gray-700 mt-1">
          {HOURS_ONLY_TYPES.has(r.load_type)
            ? LOAD_TYPE_LABEL[r.load_type]
            : <>{LOAD_TYPE_LABEL[r.load_type]}: <span className="font-medium">{r.description}</span></>}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          AY {r.academic_year}, {['','1st','2nd','Summer'][r.semester]} Semester ·{' '}
          {HOURS_ONLY_TYPES.has(r.load_type) ? `${r.hours} hours/week` : `${r.units} units`} ·{' '}
          Submitted {new Date(r.created_at).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[r.status]}`}>
          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
        </span>
        {onAction && (
          <div className="flex gap-2">
            <button
              onClick={() => onAction('approve')}
              disabled={acting}
              className="flex items-center gap-1.5 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
            >
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve
            </button>
            <button
              onClick={() => onAction('reject')}
              disabled={acting}
              className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
            >
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
