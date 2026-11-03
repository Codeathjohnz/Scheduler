import { useState, useEffect } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Loader2, ClipboardList, Undo2, FileText } from 'lucide-react'
import { submissionsAPI } from '../../services/api.js'
import ReturnReasonButton from '../../components/common/ReturnReasonButton.jsx'
import FacultyLoadingSheet from '../../components/common/FacultyLoadingSheet.jsx'

const STATUS_LABEL = {
  pending_dean:      'With Dean',
  pending_chief_cpd: 'Pending Review',
  pending_qa:        'Confirmed — with QA',
  pending_vpaa:      'Confirmed — with VPAA',
  pending_admin:     'Confirmed — with Admin',
  returned:          'Returned',
  validated:         'Validated',
  scheduled:         'Scheduled',
}

const STATUS_STYLE = {
  pending_dean:      'bg-amber-100 text-amber-800 border border-amber-200',
  pending_chief_cpd: 'bg-amber-100 text-amber-800 border border-amber-200',
  pending_qa:        'bg-green-100 text-green-800 border border-green-200',
  pending_vpaa:      'bg-green-100 text-green-800 border border-green-200',
  pending_admin:     'bg-green-100 text-green-800 border border-green-200',
  returned:          'bg-red-100 text-red-700 border border-red-200',
  validated:         'bg-blue-100 text-blue-800 border border-blue-200',
  scheduled:         'bg-purple-100 text-purple-800 border border-purple-200',
}

const REVERTIBLE_STATUSES = new Set(['pending_qa', 'pending_vpaa', 'pending_admin', 'validated'])

export default function ChiefCPDReview() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState(null)
  const [entries, setEntries]         = useState({})
  const [loadingEntries, setLoadingEntries] = useState(null)
  const [acting, setActing]           = useState(null)

  const fetchSubmissions = () => {
    setLoading(true)
    submissionsAPI.getForChiefCPD()
      .then(r => setSubmissions(r.data))
      .catch(() => toast.error('Failed to load submissions.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchSubmissions() }, [])

  const handleExpand = async (id) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (entries[id]) return
    setLoadingEntries(id)
    try {
      const r = await submissionsAPI.getEntries(id)
      setEntries(e => ({ ...e, [id]: r.data }))
    } catch {
      toast.error('Failed to load submission details.')
    } finally {
      setLoadingEntries(null)
    }
  }

  const handleAction = async (id, action, reason) => {
    setActing(id)
    try {
      await submissionsAPI.chiefCpdAction(id, action, reason)
      toast.success(
        action === 'confirm'
          ? 'Submission confirmed and forwarded to Quality Assurance.'
          : 'Submission returned to Program Chair for revision.'
      )
      fetchSubmissions()
      setExpanded(null)
    } catch {
      toast.error('Action failed. Please try again.')
    } finally {
      setActing(null)
    }
  }

  const handleRevert = async (id) => {
    if (!confirm('Revert this back to Pending Chief CPD Review? Quality Assurance, VPAA, and Admin will need to review it again.')) return
    setActing(id)
    try {
      await submissionsAPI.chiefCpdRevert(id)
      toast.success('Submission reverted to Pending Chief CPD Review.')
      fetchSubmissions()
      setExpanded(null)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Revert failed. Please try again.')
    } finally {
      setActing(null)
    }
  }

  const pending = submissions.filter(s => s.status === 'pending_chief_cpd')
  const others  = submissions.filter(s => s.status !== 'pending_chief_cpd')

  return (
    <div>
      <PageHeader
        title="Review Submissions"
        subtitle="Confirm or return faculty load submissions once the Dean has confirmed them."
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading submissions...
        </div>
      ) : submissions.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
          <ClipboardList className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-semibold text-gray-500">No submissions yet.</p>
          <p className="text-sm mt-1 text-gray-400">Submissions appear here once the Dean has confirmed them.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Awaiting Your Review ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map(sub => (
                  <SubmissionCard
                    key={sub.id}
                    sub={sub}
                    expanded={expanded === sub.id}
                    entries={entries[sub.id]}
                    loadingEntries={loadingEntries === sub.id}
                    acting={acting === sub.id}
                    onExpand={() => handleExpand(sub.id)}
                    onAction={(action, reason) => handleAction(sub.id, action, reason)}
                  />
                ))}
              </div>
            </div>
          )}

          {others.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Previously Reviewed ({others.length})
              </h2>
              <div className="space-y-3">
                {others.map(sub => (
                  <SubmissionCard
                    key={sub.id}
                    sub={sub}
                    expanded={expanded === sub.id}
                    entries={entries[sub.id]}
                    loadingEntries={loadingEntries === sub.id}
                    acting={acting === sub.id}
                    onExpand={() => handleExpand(sub.id)}
                    onAction={null}
                    onRevert={() => handleRevert(sub.id)}
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

function SubmissionCard({ sub, expanded, entries, loadingEntries, acting, onExpand, onAction, onRevert }) {
  const [showSheet, setShowSheet] = useState(false)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {showSheet && entries?.type === 'faculty_load' && (
        <FacultyLoadingSheet
          entries={entries.entries}
          adminLoads={entries.adminLoads}
          year={entries.academic_year}
          semester={entries.semester}
          collegeDept={entries.chair_dept || sub.chair_dept}
          chairName={entries.chair_name || sub.chair_name}
          onClose={() => setShowSheet(false)}
        />
      )}
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 transition" onClick={onExpand}>
        <div>
          <p className="font-semibold text-gray-800">{sub.chair_dept || 'Unknown Dept'} — {sub.chair_name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {sub.entry_count} entries · Submitted {new Date(sub.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[sub.status]}`}>
            {STATUS_LABEL[sub.status]}
          </span>
          {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5">
          {loadingEntries ? (
            <div className="flex items-center gap-2 py-4 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading entries...
            </div>
          ) : !entries ? (
            <p className="text-sm text-gray-400 py-4">No entries found for this submission.</p>
          ) : entries.type === 'faculty_load' ? (
            <div className="mt-4 mb-5">
              {entries.entries.length === 0 ? (
                <p className="text-sm text-gray-400">No entries found.</p>
              ) : (
                <button onClick={() => setShowSheet(true)}
                  className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition">
                  <FileText className="w-4 h-4" /> View Faculty Loading Sheet ({entries.entries.length} entries)
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm mt-4 mb-5">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                  <th className="text-left pb-2">Instructor</th>
                  <th className="text-left pb-2">Subject</th>
                  <th className="text-left pb-2">Section</th>
                  <th className="text-left pb-2">Program</th>
                  <th className="text-left pb-2">Year</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.entries.map((e, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="py-2 text-gray-700 font-medium">{e.instructor_name}</td>
                    <td className="py-2 text-gray-700">{e.subject_code}</td>
                    <td className="py-2 text-gray-500">{e.section}</td>
                    <td className="py-2 text-gray-500">{e.program}</td>
                    <td className="py-2 text-gray-400">Year {e.year_level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {onAction && sub.status === 'pending_chief_cpd' && (
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => onAction('confirm')}
                disabled={acting}
                className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
              >
                {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Confirm
              </button>
              <ReturnReasonButton busy={acting} onReturn={(reason) => onAction('return', reason)} />
            </div>
          )}

          {sub.status !== 'pending_chief_cpd' && sub.chief_cpd_action_at && (
            <p className="text-xs text-gray-400 mt-2">
              {STATUS_LABEL[sub.status]} on {new Date(sub.chief_cpd_action_at).toLocaleDateString()}
            </p>
          )}

          {onRevert && REVERTIBLE_STATUSES.has(sub.status) && (
            <button
              onClick={onRevert}
              disabled={acting}
              className="flex items-center gap-2 bg-white hover:bg-amber-50 border-2 border-gray-200 hover:border-amber-300 text-gray-600 hover:text-amber-700 text-sm font-semibold px-5 py-2.5 rounded-xl transition mt-3"
            >
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
              Revert My Confirmation
            </button>
          )}
          {onRevert && sub.status === 'scheduled' && (
            <p className="text-xs text-amber-600 mt-3">
              A schedule has already been generated from this submission — an admin must clear it before you can revert.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
