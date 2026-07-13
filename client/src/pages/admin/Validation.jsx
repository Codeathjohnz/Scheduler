import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import {
  ShieldCheck, Cpu, ChevronDown, ChevronUp,
  Loader2, ClipboardList, XCircle, CheckCircle2, Trash2, RotateCcw
} from 'lucide-react'
import { submissionsAPI } from '../../services/api.js'

const STATUS_LABEL = {
  pending_admin: 'Pending Validation',
  validated:     'Validated',
  scheduled:     'Scheduled',
  returned:      'Returned',
}

const STATUS_STYLE = {
  pending_admin: 'bg-amber-100 text-amber-800 border border-amber-200',
  validated:     'bg-emerald-100 text-emerald-800 border border-emerald-200',
  scheduled:     'bg-blue-100 text-blue-800 border border-blue-200',
  returned:      'bg-red-100 text-red-700 border border-red-200',
}

export default function AdminValidation() {
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState(null)
  const [entries, setEntries]         = useState({})
  const [loadingEntries, setLoadingEntries] = useState(null)
  const [acting, setActing]           = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting]       = useState(false)

  const fetchSubmissions = () => {
    setLoading(true)
    submissionsAPI.getForAdmin()
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

  const handleAction = async (id, action) => {
    setActing(id)
    try {
      await submissionsAPI.adminAction(id, action)
      toast.success(
        action === 'validate' ? 'Submission validated. Ready for schedule generation.'
        : action === 'revert' ? 'Reverted to Validated — ready to regenerate.'
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

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await submissionsAPI.remove(deleteTarget.id)
      toast.success('Submission deleted.')
      setDeleteTarget(null)
      if (expanded === deleteTarget.id) setExpanded(null)
      fetchSubmissions()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete submission.')
    } finally {
      setDeleting(false)
    }
  }

  const pending   = submissions.filter(s => s.status === 'pending_admin')
  const validated = submissions.filter(s => s.status === 'validated')
  const others    = submissions.filter(s => !['pending_admin','validated'].includes(s.status))

  const allValidated = submissions.length > 0 && pending.length === 0 && validated.length > 0

  return (
    <div>
      <PageHeader
        title="Validate Scheduling Data"
        subtitle="Review VPAA-endorsed submissions before triggering AI schedule generation."
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading submissions...
        </div>
      ) : submissions.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
          <ClipboardList className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-semibold text-gray-500">No endorsed submissions yet.</p>
          <p className="text-sm mt-1">Submissions appear here after the VPAA endorses them.</p>
        </div>
      ) : (
        <div className="space-y-6">

          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Awaiting Your Validation ({pending.length})
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
                    onAction={(action) => handleAction(sub.id, action)}
                    onDelete={() => setDeleteTarget(sub)}
                  />
                ))}
              </div>
            </div>
          )}

          {validated.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Validated ({validated.length})
              </h2>
              <div className="space-y-3">
                {validated.map(sub => (
                  <SubmissionCard
                    key={sub.id}
                    sub={sub}
                    expanded={expanded === sub.id}
                    entries={entries[sub.id]}
                    loadingEntries={loadingEntries === sub.id}
                    acting={false}
                    onExpand={() => handleExpand(sub.id)}
                    onAction={null}
                    onDelete={() => setDeleteTarget(sub)}
                  />
                ))}
              </div>
            </div>
          )}

          {others.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Other ({others.length})
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
                    onAction={sub.status === 'scheduled' ? (action) => handleAction(sub.id, action) : null}
                    onDelete={() => setDeleteTarget(sub)}
                  />
                ))}
              </div>
            </div>
          )}

          {allValidated && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 flex items-center justify-between gap-4">
              <div>
                <p className="font-bold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  All submissions validated — ready for AI scheduling.
                </p>
                <p className="text-sm text-emerald-600 mt-0.5">
                  Go to the Schedule Generator to assign rooms and time slots automatically.
                </p>
              </div>
              <button
                onClick={() => navigate('/admin/schedule-generator')}
                className="shrink-0 flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-5 py-3 rounded-xl transition shadow"
              >
                <Cpu className="w-4 h-4" />
                Generate AI Schedule
              </button>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-center font-bold text-gray-800 mb-1">Delete Submission</h3>
            <p className="text-center text-sm text-gray-500 mb-6">
              Permanently delete <span className="font-semibold text-gray-700">{deleteTarget.chair_dept} — {deleteTarget.chair_name}</span>'s submission
              {deleteTarget.submission_type === 'faculty_load' && (
                <> and its <span className="font-semibold text-gray-700">{deleteTarget.entry_count} faculty load entries</span></>
              )}? This also removes any schedule generated from it. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</> : 'Yes, Delete'}
              </button>
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SubmissionCard({ sub, expanded, entries, loadingEntries, acting, onExpand, onAction, onDelete }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 transition"
        onClick={onExpand}
      >
        <div>
          <p className="font-semibold text-gray-800">
            {sub.chair_dept || 'Unknown Dept'} — {sub.chair_name}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {sub.entry_count} entries
            {sub.academic_year ? ` · AY ${sub.academic_year}, ${['','1st','2nd','Summer'][sub.semester]} Sem` : ''}
            {' · Endorsed '}
            {sub.vpaa_action_at ? new Date(sub.vpaa_action_at).toLocaleDateString() : new Date(sub.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[sub.status] || 'bg-gray-100 text-gray-600'}`}>
            {STATUS_LABEL[sub.status] || sub.status}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="Delete submission"
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {expanded
            ? <ChevronUp className="w-5 h-5 text-gray-400" />
            : <ChevronDown className="w-5 h-5 text-gray-400" />
          }
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5">
          {loadingEntries ? (
            <div className="flex items-center gap-2 py-4 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading entries...
            </div>
          ) : !entries ? (
            <p className="text-sm text-gray-400 py-4">No entries found.</p>
          ) : entries.type === 'faculty_load' ? (
            <div className="mt-4 mb-5">
              <p className="text-xs text-blue-700 font-semibold mb-2">
                Faculty Loading Sheet — AY {entries.academic_year}, {['','1st','2nd','Summer'][entries.semester]} Semester
              </p>
              {entries.entries.length === 0 ? (
                <p className="text-sm text-gray-400">No entries found.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left">Instructor</th>
                        <th className="px-3 py-2 text-left">Course No.</th>
                        <th className="px-3 py-2 text-left">Descriptive Title</th>
                        <th className="px-3 py-2 text-left">Section</th>
                        <th className="px-3 py-2 text-center">Units</th>
                        <th className="px-3 py-2 text-center">Lec</th>
                        <th className="px-3 py-2 text-center">Lab</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {entries.entries.map((e, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-700">{e.instructor_name || '— Unassigned —'}</td>
                          <td className="px-3 py-2 font-mono text-green-800 font-semibold">{e.course_code}</td>
                          <td className="px-3 py-2 text-gray-600">{e.descriptive_title}</td>
                          <td className="px-3 py-2 text-gray-500">{e.program_yr_sec || '—'}</td>
                          <td className="px-3 py-2 text-center text-gray-600">{e.units}</td>
                          <td className="px-3 py-2 text-center text-gray-500">{e.lec_hours}</td>
                          <td className="px-3 py-2 text-center text-gray-500">{e.lab_hours}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

          {onAction && sub.status === 'pending_admin' && (
            <div className="flex gap-3 mt-1">
              <button
                onClick={() => onAction('validate')}
                disabled={acting}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
              >
                {acting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ShieldCheck className="w-4 h-4" />
                }
                Validate
              </button>
              <button
                onClick={() => onAction('return')}
                disabled={acting}
                className="flex items-center gap-2 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
              >
                {acting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <XCircle className="w-4 h-4" />
                }
                Return for Revision
              </button>
            </div>
          )}

          {onAction && sub.status === 'scheduled' && (
            <div className="flex gap-3 mt-1">
              <button
                onClick={() => onAction('revert')}
                disabled={acting}
                title="Send this back to Validated so you can regenerate the schedule (e.g. after a scheduler fix, room change, or updated faculty load)."
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
              >
                {acting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <RotateCcw className="w-4 h-4" />
                }
                Revert to Validated (Allow Regenerate)
              </button>
            </div>
          )}

          {sub.admin_action_at && sub.status !== 'pending_admin' && (
            <p className="text-xs text-gray-400 mt-2">
              {STATUS_LABEL[sub.status]} on {new Date(sub.admin_action_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
