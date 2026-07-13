import { useState, useEffect, useMemo } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Loader2, ClipboardList, Search } from 'lucide-react'
import { submissionsAPI } from '../../services/api.js'

const STATUS_LABEL = {
  pending_dean:  'With Dean',
  pending_qa:    'Pending Review',
  pending_vpaa:  'Confirmed — with VPAA',
  pending_admin: 'Confirmed — with Admin',
  returned:      'Returned',
  validated:     'Validated',
  scheduled:     'Scheduled',
}

const STATUS_STYLE = {
  pending_dean:  'bg-amber-100 text-amber-800 border border-amber-200',
  pending_qa:    'bg-amber-100 text-amber-800 border border-amber-200',
  pending_vpaa:  'bg-green-100 text-green-800 border border-green-200',
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

export default function QAReview() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState(null)
  const [entries, setEntries]         = useState({})
  const [loadingEntries, setLoadingEntries] = useState(null)
  const [acting, setActing]           = useState(null)

  const fetchSubmissions = () => {
    setLoading(true)
    submissionsAPI.getForQA()
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
      await submissionsAPI.qaAction(id, action)
      toast.success(
        action === 'confirm'
          ? 'Submission confirmed and forwarded to the VPAA.'
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

  const pending = submissions.filter(s => s.status === 'pending_qa')
  const others  = submissions.filter(s => s.status !== 'pending_qa')

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
                    onAction={(action) => handleAction(sub.id, action)}
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
                    acting={false}
                    onExpand={() => handleExpand(sub.id)}
                    onAction={null}
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

function SubmissionCard({ sub, expanded, entries, loadingEntries, acting, onExpand, onAction }) {
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
              <p className="text-xs text-blue-700 font-semibold mb-2 flex items-center gap-1">
                Faculty Loading Sheet — AY {entries.academic_year}, {['','1st','2nd','Summer'][entries.semester]} Semester
              </p>
              {entries.entries.length === 0 ? (
                <p className="text-sm text-gray-400">No entries found.</p>
              ) : (
                <>
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

          {onAction && sub.status === 'pending_qa' && (
            <div className="flex gap-3">
              <button
                onClick={() => onAction('confirm')}
                disabled={acting}
                className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
              >
                {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Confirm
              </button>
              <button
                onClick={() => onAction('return')}
                disabled={acting}
                className="flex items-center gap-2 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
              >
                {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Return for Revision
              </button>
            </div>
          )}

          {sub.status !== 'pending_qa' && sub.qa_action_at && (
            <p className="text-xs text-gray-400 mt-2">
              {STATUS_LABEL[sub.status]} on {new Date(sub.qa_action_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
