import { useState, useEffect } from 'react'
import { Users, BookOpen, Layers, CheckCircle } from 'lucide-react'
import StatCard from '../../components/ui/StatCard.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { submissionsAPI } from '../../services/api.js'

const STATUS_LABEL = {
  pending_vpaa:  'Pending VPAA Review',
  pending_admin: 'Pending Admin Review',
  returned:      'Returned for Revision',
  validated:     'Validated by Admin',
}

const STATUS_STYLE = {
  pending_vpaa:  'bg-amber-100 text-amber-800 border border-amber-200',
  pending_admin: 'bg-green-100 text-green-800 border border-green-200',
  returned:      'bg-red-100 text-red-700 border border-red-200',
  validated:     'bg-blue-100 text-blue-800 border border-blue-200',
}

export default function ChairDashboard() {
  const { user } = useAuth()
  const [submissions, setSubmissions] = useState([])

  useEffect(() => {
    submissionsAPI.getMy()
      .then(r => setSubmissions(r.data))
      .catch(() => {})
  }, [])

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name}`}
        subtitle="Program Chair – Manage and submit scheduling data for your department."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Instructors" value="12" icon={Users} color="green" />
        <StatCard label="Subjects" value="28" icon={BookOpen} color="teal" />
        <StatCard label="Sections" value="15" icon={Layers} color="gold" />
        <StatCard label="Submissions Sent" value={String(submissions.length)} icon={CheckCircle} color="blue" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="font-bold text-gray-800 text-base mb-4">Recent Submissions</h2>
        {submissions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No submissions yet.</p>
        ) : (
          <div className="space-y-3">
            {submissions.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 hover:bg-green-50 transition">
                <div>
                  <p className="text-sm font-semibold text-gray-700">
                    Submission #{s.id} — {s.entry_count} entr{s.entry_count === 1 ? 'y' : 'ies'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(s.created_at).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[s.status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABEL[s.status] || s.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
