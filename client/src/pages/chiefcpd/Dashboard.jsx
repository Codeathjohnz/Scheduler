import { useState, useEffect } from 'react'
import { ClipboardList, CheckCircle, XCircle, Clock } from 'lucide-react'
import StatCard from '../../components/ui/StatCard.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { submissionsAPI } from '../../services/api.js'

const STATUS_LABEL = {
  pending_dean:      'With Dean',
  pending_chief_cpd: 'Pending Your Review',
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

export default function ChiefCPDDashboard() {
  const { user } = useAuth()
  const [submissions, setSubmissions] = useState([])

  useEffect(() => {
    submissionsAPI.getForChiefCPD()
      .then(r => setSubmissions(r.data))
      .catch(() => {})
  }, [])

  const pending   = submissions.filter(s => s.status === 'pending_chief_cpd')
  const confirmed = submissions.filter(s => ['pending_qa', 'pending_vpaa', 'pending_admin', 'validated', 'scheduled'].includes(s.status))
  const returned  = submissions.filter(s => s.status === 'returned')

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name}`}
        subtitle="Chief Curriculum Planning and Development – Review faculty load submissions confirmed by the Dean before they reach Quality Assurance."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Pending Review"    value={String(pending.length)}     icon={Clock}         color="gold" />
        <StatCard label="Confirmed"         value={String(confirmed.length)}   icon={CheckCircle}   color="green" />
        <StatCard label="Returned"          value={String(returned.length)}    icon={XCircle}       color="red" />
        <StatCard label="Total Submissions" value={String(submissions.length)} icon={ClipboardList} color="teal" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="font-bold text-gray-800 text-base mb-4">Awaiting Your Review</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No submissions pending review.</p>
        ) : (
          <div className="space-y-3">
            {pending.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 hover:bg-amber-100 transition">
                <div>
                  <p className="text-sm font-bold text-gray-800">{s.chair_dept} — {s.chair_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.entry_count} entries · Submitted {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
