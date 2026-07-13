import { useState, useEffect } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { schedulingAPI } from '../../services/api.js'
import toast from 'react-hot-toast'
import { Loader2, CalendarX2, Clock, DoorOpen, LayoutGrid, List } from 'lucide-react'

const DAYS      = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const DAY_SHORT = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat' }

const PX_PER_MIN = 1
const GRID_START = 7 * 60
const GRID_END   = 21 * 60
const HOUR_LABELS = Array.from({ length: 15 }, (_, i) => 7 + i)

function timeToMin(t) {
  const [h, m] = (t || '00:00').split(':').map(Number)
  return h * 60 + m
}

function fmt12(t) {
  const [h, m] = (t || '00:00').split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${suffix}`
}

function strColor(str) {
  let h = 0
  for (let i = 0; i < (str||'').length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff
  const hue = Math.abs(h) % 360
  return { bg: `hsl(${hue},55%,88%)`, border: `hsl(${hue},55%,55%)`, text: `hsl(${hue},40%,25%)` }
}

function Block({ slot }) {
  const colors = strColor(slot.instructor_name || slot.course_code)
  const top    = (timeToMin(slot.start_time) - GRID_START) * PX_PER_MIN
  const height = (timeToMin(slot.end_time) - timeToMin(slot.start_time)) * PX_PER_MIN - 2

  return (
    <div className="absolute left-0.5 right-0.5 rounded-lg px-1.5 py-1 overflow-hidden"
      style={{ top, height, minHeight: 24, background: colors.bg, borderLeft: `3px solid ${colors.border}` }}
      title={`${slot.course_code} — ${slot.program_yr_sec || ''}\n${slot.instructor_name || '—'}\n${slot.room_name || 'No room'}\n${fmt12(slot.start_time)} – ${fmt12(slot.end_time)}`}
    >
      <p className="font-bold text-[10px] leading-tight truncate" style={{ color: colors.text }}>{slot.course_code}</p>
      {height > 28 && <p className="text-[9px] leading-tight truncate opacity-80" style={{ color: colors.text }}>{slot.program_yr_sec}</p>}
      {height > 42 && <p className="text-[9px] leading-tight truncate opacity-70" style={{ color: colors.text }}>{slot.room_name || '—'}</p>}
    </div>
  )
}

export default function ChairScheduleView() {
  const [year, setYear]         = useState('2026-2027')
  const [semester, setSemester] = useState(1)
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading]   = useState(true)
  const [viewMode, setViewMode] = useState('grid')

  useEffect(() => {
    setLoading(true)
    schedulingAPI.getDept(year, semester)
      .then(r => setSchedules(r.data))
      .catch(() => toast.error('Failed to load schedule.'))
      .finally(() => setLoading(false))
  }, [year, semester])

  const byDay = {}
  DAYS.forEach(d => { byDay[d] = [] })
  for (const slot of schedules) {
    for (const d of slot.days.split(',').map(d => d.trim())) {
      if (byDay[d]) byDay[d].push(slot)
    }
  }

  const instructors = [...new Map(schedules.filter(s => s.instructor_name).map(s => [s.instructor_id, s.instructor_name])).entries()]
  const semLabel = semester === 1 ? '1st Semester' : semester === 2 ? '2nd Semester' : 'Summer'

  return (
    <div>
      <PageHeader
        title="Schedule Overview"
        subtitle="Published schedule for your department's instructors and sections."
      />

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
          <input value={year} onChange={e => setYear(e.target.value)}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 w-32" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
          <select value={semester} onChange={e => setSemester(Number(e.target.value))}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 bg-white">
            <option value={1}>1st Semester</option>
            <option value={2}>2nd Semester</option>
            <option value={3}>Summer</option>
          </select>
        </div>
        <div className="ml-auto flex border-2 border-gray-200 rounded-xl overflow-hidden">
          <button onClick={() => setViewMode('grid')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition ${viewMode==='grid'?'bg-green-700 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
            <LayoutGrid className="w-3.5 h-3.5"/> Timetable
          </button>
          <button onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition ${viewMode==='list'?'bg-green-700 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
            <List className="w-3.5 h-3.5"/> List
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-28 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading schedule...
        </div>
      ) : schedules.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center justify-center py-28 text-gray-400">
          <CalendarX2 className="w-14 h-14 mb-4 opacity-20" />
          <p className="font-semibold text-gray-500 text-base">No published schedule yet.</p>
          <p className="text-sm mt-1 text-center max-w-xs">
            The Admin hasn't published the schedule for <strong>{semLabel} {year}</strong> yet.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: 700 }}>
              <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: '56px repeat(6,1fr)' }}>
                <div className="py-2 border-r border-gray-100" />
                {DAYS.map(d => (
                  <div key={d} className={`py-2 text-xs font-bold text-center border-r border-gray-100 last:border-0 ${byDay[d].length ? 'text-gray-700' : 'text-gray-300'}`}>
                    {DAY_SHORT[d]}
                  </div>
                ))}
              </div>
              <div className="grid" style={{ gridTemplateColumns: '56px repeat(6,1fr)' }}>
                <div className="relative border-r border-gray-100" style={{ height: (GRID_END - GRID_START) * PX_PER_MIN }}>
                  {HOUR_LABELS.map(h => (
                    <div key={h} className="absolute w-full flex items-start justify-end pr-2"
                      style={{ top: (h * 60 - GRID_START) * PX_PER_MIN - 8 }}>
                      <span className="text-[9px] text-gray-400 font-medium">
                        {h === 12 ? '12PM' : h < 12 ? `${h}AM` : `${h-12}PM`}
                      </span>
                    </div>
                  ))}
                </div>
                {DAYS.map(day => (
                  <div key={day} className="relative border-r border-gray-100 last:border-0"
                    style={{ height: (GRID_END - GRID_START) * PX_PER_MIN }}>
                    {HOUR_LABELS.map(h => (
                      <div key={h} className="absolute w-full border-t border-gray-100"
                        style={{ top: (h * 60 - GRID_START) * PX_PER_MIN }} />
                    ))}
                    <div className="absolute w-full bg-gray-50"
                      style={{ top: (720 - GRID_START) * PX_PER_MIN, height: 60 * PX_PER_MIN }} />
                    {byDay[day].map(slot => (
                      <Block key={`${slot.id}-${day}`} slot={slot} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex border-t border-gray-100">
                <div style={{ width: 56 }} className="shrink-0" />
                <div className="flex-1 text-center py-0.5 text-[10px] text-gray-400 font-medium bg-gray-50 border-l border-gray-100">
                  LUNCH BREAK (12:00 – 1:00 PM)
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map(s => {
            const colors = strColor(s.instructor_name || s.course_code)
            return (
              <div key={s.id} className="bg-white rounded-2xl border border-gray-200 flex items-center gap-4 px-5 py-4 shadow-sm">
                <div className="w-1.5 self-stretch rounded-full shrink-0" style={{ background: colors.border }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold text-gray-800">{s.course_code}</span>
                    {s.program_yr_sec && <span className="text-xs text-gray-500">{s.program_yr_sec}</span>}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.session_type === 'lab' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {s.session_type}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{s.descriptive_title}</p>
                  {s.instructor_name && <p className="text-xs text-green-700 font-medium mt-0.5">{s.instructor_name}</p>}
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                    {s.days.split(',').map(d => DAY_SHORT[d.trim()]).join('/')} {fmt12(s.start_time)}–{fmt12(s.end_time)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <DoorOpen className="w-3.5 h-3.5 text-gray-400" />
                    {s.room_name || '—'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {schedules.length > 0 && (
        <div className="mt-4 bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Instructors in this schedule</p>
          <div className="flex flex-wrap gap-2">
            {instructors.map(([id, name]) => (
              <span key={id} className="text-xs bg-green-50 border border-green-200 text-green-800 font-medium px-3 py-1 rounded-full">{name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
