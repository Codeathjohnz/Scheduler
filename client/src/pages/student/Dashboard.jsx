import { useState, useEffect } from 'react'
import { CalendarDays, BookOpen, Clock, DoorOpen, Loader2 } from 'lucide-react'
import StatCard from '../../components/ui/StatCard.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { schedulingAPI } from '../../services/api.js'
import NotificationBox from '../../components/common/NotificationBox.jsx'

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function fmt12(t) {
  const [h, m] = (t || '00:00').split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${suffix}`
}

export default function StudentDashboard() {
  const { user } = useAuth()
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading]     = useState(true)
  const [year]     = useState('2026-2027')
  const [semester] = useState(1)

  useEffect(() => {
    schedulingAPI.getMySection(year, semester)
      .then(r => setSchedules(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [year, semester])

  const todayName = DAY_NAMES[new Date().getDay()]
  const todayClasses = schedules.filter(s =>
    s.days.split(',').map(d => d.trim()).includes(todayName)
  ).sort((a, b) => a.start_time.localeCompare(b.start_time))

  const uniqueSubjects = [...new Map(schedules.map(s => [s.faculty_entry_id, s])).values()]

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name}`}
        subtitle={`Student · ${user?.department} – View your class schedule and room assignments.`}
      />
      <NotificationBox />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Enrolled Subjects"  value={loading ? '—' : uniqueSubjects.length} icon={BookOpen}     color="green" />
        <StatCard label="Classes Today"      value={loading ? '—' : todayClasses.length}   icon={Clock}        color="gold" />
        <StatCard label="Total Classes/Week" value={loading ? '—' : schedules.length}       icon={CalendarDays} color="teal" />
        <StatCard label="Section"            value={user?.section || '—'}                  icon={DoorOpen}     color="blue" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="font-bold text-gray-800 text-base mb-4">
          Today's Classes <span className="text-sm font-normal text-gray-400">({todayName})</span>
        </h2>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        ) : todayClasses.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">
            {schedules.length === 0
              ? 'No published schedule yet. Check back after the Admin publishes the schedule.'
              : `No classes scheduled for ${todayName}.`
            }
          </p>
        ) : (
          <div className="space-y-3">
            {todayClasses.map(cls => (
              <div key={cls.id} className="flex items-center gap-4 bg-green-50 border border-green-100 rounded-xl px-4 py-3 hover:bg-green-100 transition">
                <div className="bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0">
                  {fmt12(cls.start_time)} – {fmt12(cls.end_time)}
                </div>
                <div>
                  <p className="font-bold text-gray-800 text-sm">{cls.course_code}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{cls.instructor_name || 'TBA'} · {cls.room_name || 'No room assigned'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
