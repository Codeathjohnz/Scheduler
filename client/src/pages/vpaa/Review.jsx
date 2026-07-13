import { useState, useEffect, useMemo } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Loader2, ClipboardList, Search, Trash2 } from 'lucide-react'
import { submissionsAPI } from '../../services/api.js'

const STATUS_LABEL = {
  pending_vpaa:  'Pending Review',
  pending_admin: 'Endorsed',
  returned:      'Returned',
  validated:     'Validated',
  scheduled:     'Scheduled',
}

const STATUS_STYLE = {
  pending_vpaa:  'bg-amber-100 text-amber-800 border border-amber-200',
  pending_admin: 'bg-green-100 text-green-800 border border-green-200',
  returned:      'bg-red-100 text-red-700 border border-red-200',
  validated:     'bg-blue-100 text-blue-800 border border-blue-200',
  scheduled:     'bg-purple-100 text-purple-800 border border-purple-200',
}

const YEAR_LABEL = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' }
const YEAR_COLORS = {
  1: 'bg-blue-50 border-blue-200 text-blue-800',
  2: 'bg-green-50 border-green-200 text-green-800',
  3: 'bg-amber-50 border-amber-200 text-amber-800',
  4: 'bg-purple-50 border-purple-200 text-purple-800',
}

export default function VPAAReview() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState(null)
  const [entries, setEntries]         = useState({})   // { [submissionId]: [...] }
  const [loadingEntries, setLoadingEntries] = useState(null)
  const [acting, setActing]           = useState(null) // id being acted on
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting]       = useState(false)

  const fetchSubmissions = () => {
    setLoading(true)
    submissionsAPI.getForVPAA()
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
      // r.data = { type: 'faculty_load'|'manual', entries: [...] }
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
      await submissionsAPI.vpaaAction(id, action)
      toast.success(
        action === 'endorse'
          ? 'Submission endorsed and forwarded to Admin/Registrar.'
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

  const pending = submissions.filter(s => s.status === 'pending_vpaa')
  const others  = submissions.filter(s => s.status !== 'pending_vpaa')

  return (
    <div>
      <PageHeader
        title="Review Submissions"
        subtitle="Review and endorse or return scheduling data from Program Chairs."
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading submissions...
        </div>
      ) : submissions.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
          <ClipboardList className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-semibold text-gray-500">No submissions yet.</p>
          <p className="text-sm mt-1 text-gray-400">Program Chairs have not submitted any data yet.</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* Pending review */}
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
                    onAction={(action) => handleAction(sub.id, action)}
                    onDelete={() => setDeleteTarget(sub)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Already acted on */}
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
                    acting={false}
                    onExpand={() => handleExpand(sub.id)}
                    onAction={null}
                    onDelete={() => setDeleteTarget(sub)}
                  />
                ))}
              </div>
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
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState('all')

  const filteredEntries = useMemo(() => {
    if (!entries || entries.type !== 'faculty_load') return null
    const q = search.trim().toLowerCase()
    return entries.entries.filter(e => {
      if (yearFilter !== 'all' && String(e.year_level || '') !== yearFilter) return false
      if (q) {
        const hay = `${e.instructor_name || ''} ${e.course_code || ''} ${e.descriptive_title || ''} ${e.program_yr_sec || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, search, yearFilter])

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header row */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 transition"
        onClick={onExpand}
      >
        <div>
          <p className="font-semibold text-gray-800">
            {sub.chair_dept || 'Unknown Dept'} — {sub.chair_name}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {sub.entry_count} entries · Submitted {new Date(sub.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[sub.status]}`}>
            {STATUS_LABEL[sub.status]}
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

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5">
          {loadingEntries ? (
            <div className="flex items-center gap-2 py-4 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading entries...
            </div>
          ) : !entries ? (
            <p className="text-sm text-gray-400 py-4">No entries found for this submission.</p>
          ) : entries.type === 'faculty_load' ? (
            /* ── Faculty Load entries (rich) ── */
            <div className="mt-4 mb-5">
              <p className="text-xs text-blue-700 font-semibold mb-2 flex items-center gap-1">
                Faculty Loading Sheet — AY {entries.academic_year}, {['','1st','2nd','Summer'][entries.semester]} Semester
              </p>
              {entries.entries.length === 0 ? (
                <p className="text-sm text-gray-400">No entries found.</p>
              ) : (
                <>
                  {/* Filter bar */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search course, title, section, or instructor…"
                        className="w-full border-2 border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <select value={yearFilter} onChange={e => setYearFilter(e.target.value)}
                      className="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-400">
                      <option value="all">All Years</option>
                      {Object.entries(YEAR_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {filteredEntries.length} of {entries.entries.length}
                    </span>
                  </div>

                  {filteredEntries.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No entries match this filter.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-gray-100">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500 uppercase">
                          <tr>
                            <th className="px-3 py-2 text-left">Instructor</th>
                            <th className="px-3 py-2 text-left">Course No.</th>
                            <th className="px-3 py-2 text-left">Descriptive Title</th>
                            <th className="px-3 py-2 text-left">Section</th>
                            <th className="px-3 py-2 text-left">Year</th>
                            <th className="px-3 py-2 text-center">Units</th>
                            <th className="px-3 py-2 text-center">Lec</th>
                            <th className="px-3 py-2 text-center">Lab</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredEntries.map((e, i) => (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-medium text-gray-700">{e.instructor_name || '— Unassigned —'}</td>
                              <td className="px-3 py-2 font-mono text-green-800 font-semibold">{e.course_code}</td>
                              <td className="px-3 py-2 text-gray-600">{e.descriptive_title}</td>
                              <td className="px-3 py-2 text-gray-500">{e.program_yr_sec || '—'}</td>
                              <td className="px-3 py-2">
                                {e.year_level ? (
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${YEAR_COLORS[e.year_level]}`}>
                                    {YEAR_LABEL[e.year_level]}
                                  </span>
                                ) : (
                                  <span className="text-gray-300 italic">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-center text-gray-600">{e.units}</td>
                              <td className="px-3 py-2 text-center text-gray-500">{e.lec_hours}</td>
                              <td className="px-3 py-2 text-center text-gray-500">{e.lab_hours}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* ── Manual submission entries ── */
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

          {/* Actions — only for pending_vpaa */}
          {onAction && sub.status === 'pending_vpaa' && (
            <div className="flex gap-3">
              <button
                onClick={() => onAction('endorse')}
                disabled={acting}
                className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
              >
                {acting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <CheckCircle className="w-4 h-4" />
                }
                Endorse
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

          {/* Already acted — show timestamp */}
          {sub.status !== 'pending_vpaa' && sub.vpaa_action_at && (
            <p className="text-xs text-gray-400 mt-2">
              {STATUS_LABEL[sub.status]} on {new Date(sub.vpaa_action_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
