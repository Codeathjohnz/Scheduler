import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import api from '../../services/api.js'
import PageHeader from '../../components/ui/PageHeader.jsx'
import {
  Cpu, Printer, AlertTriangle, CheckCircle2,
  Loader2, X, Edit2, Globe, Trash2
} from 'lucide-react'

/* ── constants ─────────────────────────────────────────────────────────────── */
const DAYS    = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const DAY_SHORT = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat' }

// Timetable pixel layout
const PX_PER_MIN  = 1       // 1 px per minute  → 60 px per hour
const GRID_START  = 7 * 60  // 7:00 AM
const GRID_END    = 21 * 60 // 9:00 PM
const GRID_HEIGHT = (GRID_END - GRID_START) * PX_PER_MIN  // 840px

// Hour labels along the left axis
const HOUR_LABELS = Array.from({ length: 15 }, (_, i) => 7 + i)  // 7..21

function timeToMin(t) {
  const [h, m] = (t || '00:00').split(':').map(Number)
  return h * 60 + m
}

// Stable color from a string (instructor name or section)
function strColor(str) {
  let h = 0
  for (let i = 0; i < (str||'').length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff
  const hue = Math.abs(h) % 360
  return { bg: `hsl(${hue},55%,88%)`, border: `hsl(${hue},55%,55%)`, text: `hsl(${hue},40%,25%)` }
}

// Stable Tailwind color palette per department name
const DEPT_PALETTE = [
  { light: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-300',   bar: 'bg-blue-500',   active: 'bg-blue-600 text-white',   ring: 'ring-blue-400'   },
  { light: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300', bar: 'bg-purple-500', active: 'bg-purple-600 text-white', ring: 'ring-purple-400' },
  { light: 'bg-emerald-100',text: 'text-emerald-700',border: 'border-emerald-300',bar: 'bg-emerald-500',active: 'bg-emerald-600 text-white',ring: 'ring-emerald-400'},
  { light: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', bar: 'bg-orange-500', active: 'bg-orange-600 text-white', ring: 'ring-orange-400' },
  { light: 'bg-rose-100',   text: 'text-rose-700',   border: 'border-rose-300',   bar: 'bg-rose-500',   active: 'bg-rose-600 text-white',   ring: 'ring-rose-400'   },
  { light: 'bg-teal-100',   text: 'text-teal-700',   border: 'border-teal-300',   bar: 'bg-teal-500',   active: 'bg-teal-600 text-white',   ring: 'ring-teal-400'   },
  { light: 'bg-amber-100',  text: 'text-amber-700',  border: 'border-amber-300',  bar: 'bg-amber-500',  active: 'bg-amber-600 text-white',  ring: 'ring-amber-400'  },
  { light: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300', bar: 'bg-indigo-500', active: 'bg-indigo-600 text-white', ring: 'ring-indigo-400' },
]
function deptColor(dept) {
  let h = 0
  for (let i = 0; i < (dept||'').length; i++) h = (h * 31 + dept.charCodeAt(i)) & 0xffffffff
  return DEPT_PALETTE[Math.abs(h) % DEPT_PALETTE.length]
}

/* ── edit modal ─────────────────────────────────────────────────────────────── */
function EditModal({ slot, rooms, onSave, onClose }) {
  const [form, setForm] = useState({
    room_id:    slot.room_id || '',
    days:       slot.days,
    start_time: slot.start_time?.slice(0,5) || '08:00',
    end_time:   slot.end_time?.slice(0,5)   || '09:00',
  })
  const [saving, setSaving] = useState(false)
  const [conflicts, setConflicts] = useState([])

  const handleSave = async () => {
    setSaving(true); setConflicts([])
    try {
      await api.put(`/scheduling/${slot.id}`, form)
      toast.success('Schedule updated.')
      onSave()
    } catch (err) {
      const c = err.response?.data?.conflicts
      if (c) setConflicts(c)
      else toast.error(err.response?.data?.message || 'Update failed.')
    } finally { setSaving(false) }
  }

  const currentDays = form.days.split(',').map(d => d.trim())

  const toggleDay = (day) => {
    const days = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day]
    setForm(f => ({ ...f, days: days.join(',') }))
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-green-800 rounded-t-2xl">
          <div>
            <p className="text-white font-bold">{slot.course_code} — Manual Override</p>
            <p className="text-green-300 text-xs">{slot.descriptive_title}</p>
          </div>
          <button onClick={onClose} className="text-green-300 hover:text-white"><X className="w-5 h-5"/></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {conflicts.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 space-y-1">
              {conflicts.map((c,i) => <p key={i} className="text-xs text-red-700">⚠ {c}</p>)}
            </div>
          )}

          {/* Days */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Days</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(d => (
                <button key={d} type="button"
                  onClick={() => toggleDay(d)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border-2 transition ${
                    currentDays.includes(d)
                      ? 'bg-green-700 border-green-700 text-white'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-green-400'
                  }`}>{DAY_SHORT[d]}</button>
              ))}
            </div>
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-3">
            {[['Start Time','start_time'],['End Time','end_time']].map(([label,field])=>(
              <div key={field}>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
                <input type="time" value={form[field]}
                  onChange={e=>setForm(f=>({...f,[field]:e.target.value}))}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
              </div>
            ))}
          </div>

          {/* Room */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Room</label>
            <select value={form.room_id} onChange={e=>setForm(f=>({...f,room_id:e.target.value}))}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 bg-white">
              <option value="">— No room —</option>
              {['Lecture','Laboratory','Special'].map(type => {
                const rms = rooms.filter(r => r.room_type === type)
                if (!rms.length) return null
                return (
                  <optgroup key={type} label={type}>
                    {rms.map(r => <option key={r.id} value={r.id}>{r.building} {r.room_number} (cap {r.capacity})</option>)}
                  </optgroup>
                )
              })}
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={handleSave} disabled={saving || !form.days}
              className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
              {saving?<><Loader2 className="w-4 h-4 animate-spin"/>Saving...</>:'Save Override'}
            </button>
            <button onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── timetable block ────────────────────────────────────────────────────────── */
function ScheduleBlock({ slot, onEdit }) {
  const colors = strColor(slot.instructor_name || slot.program_yr_sec || '')
  const top    = (timeToMin(slot.start_time) - GRID_START) * PX_PER_MIN
  const height = (timeToMin(slot.end_time) - timeToMin(slot.start_time)) * PX_PER_MIN - 2

  return (
    <div
      className={`absolute left-0.5 right-0.5 rounded-lg px-1.5 py-1 overflow-hidden cursor-pointer group transition hover:shadow-md ${slot.hasConflict?'ring-2 ring-red-500':''}`}
      style={{ top, height, minHeight:24, background: colors.bg, borderLeft: `3px solid ${colors.border}` }}
      onClick={() => onEdit(slot)}
      title={`${slot.course_code} — ${slot.program_yr_sec}\n${slot.instructor_name}\n${slot.room_name || 'No room'}\n${slot.start_time?.slice(0,5)}–${slot.end_time?.slice(0,5)}`}
    >
      <p className="font-bold text-[10px] leading-tight truncate" style={{ color: colors.text }}>{slot.course_code}</p>
      {height > 30 && <p className="text-[9px] leading-tight truncate opacity-80" style={{ color: colors.text }}>{slot.program_yr_sec}</p>}
      {height > 44 && <p className="text-[9px] leading-tight truncate opacity-70" style={{ color: colors.text }}>{slot.room_name || '—'}</p>}
      {slot.hasConflict && <span className="absolute top-0 right-0 bg-red-500 text-white text-[8px] px-1 py-0.5 rounded-bl">CONFLICT</span>}
      {slot.is_manual ? <span className="absolute bottom-0 right-0 bg-amber-400 text-green-900 text-[8px] px-1 rounded-tl">M</span> : null}
      <Edit2 className="w-2.5 h-2.5 absolute top-1 right-1 opacity-0 group-hover:opacity-60 transition" style={{ color: colors.text }} />
    </div>
  )
}

/* ── main page ──────────────────────────────────────────────────────────────── */
export default function ScheduleGenerator() {
  const [year, setYear]         = useState('2026-2027')
  const [semester, setSemester] = useState(1)
  const [schedules, setSchedules] = useState([])
  const [conflicts, setConflicts] = useState([])
  const [rooms, setRooms]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editSlot, setEditSlot] = useState(null)
  const [filterBy, setFilterBy] = useState('all')   // 'all' | instructor id | room id | section string
  const [filterType, setFilterType] = useState('all') // 'all' | 'instructor' | 'room' | 'section'
  const [unscheduled, setUnscheduled] = useState([])
  const [showUnscheduled, setShowUnscheduled] = useState(false)
  const [engine, setEngine] = useState('greedy')   // 'greedy' | 'genetic' | 'ortools'
  const [lastRun, setLastRun] = useState(null)      // stats from the most recent generate call

  const fetchSchedules = async () => {
    setLoading(true)
    try {
      const r = await api.get(`/scheduling?year=${year}&semester=${semester}`)
      setSchedules(r.data.schedules)
      setConflicts(r.data.conflicts)
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to load schedules.') }
    finally { setLoading(false) }
  }

  const fetchRooms = async () => {
    try { const r = await api.get('/scheduling/rooms'); setRooms(r.data) } catch {}
  }

  useEffect(() => { fetchSchedules(); fetchRooms() }, [year, semester])

  const handleGenerate = async () => {
    if (!confirm('This will replace all existing schedules for this term. Continue?')) return
    setGenerating(true); setUnscheduled([]); setLastRun(null)
    try {
      const r = await api.post('/scheduling/generate', { year, semester, clear_existing: true, engine })
      setLastRun(r.data)
      const engineLabel = r.data.engine === 'genetic' ? 'Genetic Algorithm' : r.data.engine === 'ortools' ? 'Google OR-Tools' : 'Greedy'
      toast.success(`${engineLabel} engine generated ${r.data.scheduled} sessions in ${r.data.engineRuntimeMs}ms.`)
      if (r.data.unscheduled > 0) {
        toast(`${r.data.unscheduled} session(s) could not be scheduled — see warnings below.`, { icon: '⚠' })
        setUnscheduled(r.data.unscheduledList)
        setShowUnscheduled(true)
      }
      fetchSchedules()
    } catch (err) { toast.error(err.response?.data?.message || 'Generation failed.') }
    finally { setGenerating(false) }
  }

  const handlePublish = async () => {
    if (!confirm('Publish the schedule? Instructors and students will be able to see it.')) return
    try {
      await api.post('/scheduling/publish', { year, semester })
      toast.success('Schedule published!')
      fetchSchedules()
    } catch (err) { toast.error(err.response?.data?.message || 'Publish failed.') }
  }

  const handleClear = async () => {
    if (!confirm('Clear ALL schedule entries for this term?')) return
    try {
      await api.delete(`/scheduling/clear?year=${year}&semester=${semester}`)
      toast.success('Schedules cleared.')
      setSchedules([]); setConflicts([])
    } catch (err) { toast.error(err.response?.data?.message || 'Failed.') }
  }

  // Filter options
  const instructors  = [...new Map(schedules.filter(s=>s.instructor_name).map(s=>[s.instructor_id, s.instructor_name])).entries()].map(([id,name])=>({id,name}))
  const sections     = [...new Set(schedules.filter(s=>s.program_yr_sec).map(s=>s.program_yr_sec))]
  const roomList     = [...new Map(schedules.filter(s=>s.room_id).map(s=>[s.room_id, s.room_name])).entries()].map(([id,name])=>({id,name}))
  const departments  = [...new Set(schedules.filter(s=>s.dept).map(s=>s.dept))].sort()

  // Dept stats: sessions + rooms + pre-computed bar pct relative to busiest dept
  const deptStats = (() => {
    const raw = departments.map(dept => {
      const rows = schedules.filter(s => s.dept === dept)
      return { dept, sessions: rows.length, rooms: new Set(rows.filter(s=>s.room_id).map(s=>s.room_name)).size }
    }).sort((a, b) => b.sessions - a.sessions)
    const top = raw[0]?.sessions || 1
    return raw.map(d => ({ ...d, pct: Math.round((d.sessions / top) * 100) }))
  })()

  // Filter schedules
  const filtered = schedules.filter(s => {
    if (filterType === 'instructor') return String(s.instructor_id) === String(filterBy)
    if (filterType === 'room')       return String(s.room_id)       === String(filterBy)
    if (filterType === 'section')    return s.program_yr_sec        === filterBy
    if (filterType === 'dept')       return s.dept                  === filterBy
    return true
  })

  // Group filtered slots by day
  const byDay = {}
  DAYS.forEach(d => { byDay[d] = [] })
  for (const slot of filtered) {
    const slotDays = slot.days.split(',').map(d => d.trim())
    for (const d of slotDays) {
      if (byDay[d]) byDay[d].push(slot)
    }
  }

  const publishedCount = schedules.filter(s => s.is_published).length

  return (
    <div>
      <PageHeader
        title="Schedule Generator"
        subtitle="AI-based conflict-free scheduling engine. Generate, review, and manually adjust room and time assignments."
      />

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 mb-5">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
          <input value={year} onChange={e=>setYear(e.target.value)}
            className="border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 w-36" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
          <select value={semester} onChange={e=>setSemester(Number(e.target.value))}
            className="border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 bg-white">
            <option value={1}>1st Semester</option>
            <option value={2}>2nd Semester</option>
            <option value={3}>Summer</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Engine</label>
          <div className="flex border-2 border-gray-200 rounded-xl overflow-hidden">
            <button type="button" onClick={()=>setEngine('greedy')}
              title="Fast constructive heuristic — one pass, near-instant"
              className={`px-3 py-2.5 text-xs font-semibold transition ${engine==='greedy'?'bg-green-700 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
              Greedy (Fast)
            </button>
            <button type="button" onClick={()=>setEngine('genetic')}
              title="Genetic Algorithm — evolves complete candidate schedules over many generations, may find a better arrangement at the cost of runtime"
              className={`px-3 py-2.5 text-xs font-semibold transition ${engine==='genetic'?'bg-purple-700 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
              Genetic Algorithm
            </button>
            <button type="button" onClick={()=>setEngine('ortools')}
              title="Google OR-Tools (CP-SAT) — constraint-programming solver, guarantees no room/instructor/section double-booking by construction"
              className={`px-3 py-2.5 text-xs font-semibold transition ${engine==='ortools'?'bg-blue-700 text-white':'bg-white text-gray-500 hover:bg-gray-50'}`}>
              OR-Tools
            </button>
          </div>
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold px-4 py-2.5 rounded-xl transition shadow text-sm">
            {generating
              ? <><Loader2 className="w-4 h-4 animate-spin"/>Generating...</>
              : <><Cpu className="w-4 h-4"/>Generate Schedule</>}
          </button>
          {schedules.length > 0 && <>
            <button onClick={handlePublish}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2.5 rounded-xl transition text-sm">
              <Globe className="w-4 h-4"/> Publish
            </button>
            <button onClick={() => window.print()}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 py-2.5 rounded-xl transition text-sm">
              <Printer className="w-4 h-4"/> Print
            </button>
            <button onClick={handleClear}
              className="flex items-center gap-2 bg-white hover:bg-red-50 border-2 border-gray-200 hover:border-red-300 text-gray-600 hover:text-red-600 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
              <Trash2 className="w-4 h-4"/> Clear
            </button>
          </>}
        </div>
      </div>

      {/* Status chips */}
      {schedules.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          <span className="flex items-center gap-1.5 text-xs bg-green-100 text-green-800 font-semibold px-3 py-1.5 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5"/> {schedules.length} sessions scheduled
          </span>
          {publishedCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs bg-blue-100 text-blue-800 font-semibold px-3 py-1.5 rounded-full">
              <Globe className="w-3.5 h-3.5"/> {publishedCount} published
            </span>
          )}
          {conflicts.length > 0 && (
            <button onClick={() => {}} className="flex items-center gap-1.5 text-xs bg-red-100 text-red-700 font-semibold px-3 py-1.5 rounded-full hover:bg-red-200 transition">
              <AlertTriangle className="w-3.5 h-3.5"/> {conflicts.length} conflict{conflicts.length>1?'s':''}
            </button>
          )}
          {lastRun?.engine === 'genetic' && (
            <span className="flex items-center gap-1.5 text-xs bg-purple-100 text-purple-800 font-semibold px-3 py-1.5 rounded-full"
              title="Fitness = soft-constraint score minus heavy penalties for any conflicts or unscheduled sessions">
              <Cpu className="w-3.5 h-3.5"/> GA: {lastRun.generationsRun} generations · fitness {lastRun.finalFitness} · {lastRun.engineRuntimeMs}ms
              {lastRun.hardConflicts > 0 && <span className="text-red-700"> · {lastRun.hardConflicts} hard conflict{lastRun.hardConflicts>1?'s':''}!</span>}
            </span>
          )}
          {lastRun?.engine === 'ortools' && (
            <span className="flex items-center gap-1.5 text-xs bg-blue-100 text-blue-800 font-semibold px-3 py-1.5 rounded-full"
              title="CP-SAT constraint solver — status OPTIMAL/FEASIBLE means all hard constraints (no double-booking) were satisfied by construction">
              <Cpu className="w-3.5 h-3.5"/> OR-Tools: {lastRun.solverStatus} · objective {lastRun.objectiveValue} · {lastRun.engineRuntimeMs}ms
            </span>
          )}
        </div>
      )}

      {/* Conflict panel */}
      {conflicts.length > 0 && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-red-200 bg-red-100">
            <AlertTriangle className="w-4 h-4 text-red-600"/>
            <span className="font-bold text-red-700 text-sm">Scheduling Conflicts Detected</span>
          </div>
          <div className="px-4 py-3 space-y-1">
            {conflicts.map((c, i) => (
              <p key={i} className="text-xs text-red-700">• {c.message}</p>
            ))}
          </div>
        </div>
      )}

      {/* Unscheduled warnings */}
      {showUnscheduled && unscheduled.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-amber-200 bg-amber-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700"/>
              <span className="font-bold text-amber-800 text-sm">Could Not Schedule ({unscheduled.length})</span>
            </div>
            <button onClick={() => setShowUnscheduled(false)} className="text-amber-600 hover:text-amber-800"><X className="w-4 h-4"/></button>
          </div>
          <div className="px-4 py-3 space-y-1">
            {unscheduled.map((u, i) => (
              <p key={i} className="text-xs text-amber-800">• <strong>{u.course}</strong> ({u.type}): {u.reason}</p>
            ))}
            <p className="text-xs text-amber-600 mt-2">Add more rooms or use manual override to schedule these sessions.</p>
          </div>
        </div>
      )}

      {/* Department statistics */}
      {schedules.length > 0 && deptStats.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-800 text-sm">Room Usage by Department</h3>
            <span className="text-xs text-gray-400">{schedules.length} total sessions</span>
          </div>
          <div className="space-y-3">
            {deptStats.map(({ dept, sessions, rooms, pct }) => {
              const color = deptColor(dept)
              return (
                <div key={dept}>
                  <div className="flex items-center justify-between mb-1">
                    <button
                      onClick={() => { setFilterType('dept'); setFilterBy(dept) }}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition ${filterType==='dept'&&filterBy===dept ? `${color.active} ring-2 ring-offset-1 ${color.ring}` : `${color.light} ${color.text} ${color.border} hover:opacity-80`}`}
                    >
                      {dept}
                    </button>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span><strong className="text-gray-700">{sessions}</strong> sessions</span>
                      <span><strong className="text-gray-700">{rooms}</strong> room{rooms !== 1 ? 's' : ''}</span>
                      <span className={`font-bold ${color.text}`}>{Math.round((sessions / schedules.length) * 100)}%</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${color.bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          {filterType === 'dept' && (
            <button
              onClick={() => { setFilterType('all'); setFilterBy('all') }}
              className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Clear department filter
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      {schedules.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {/* All */}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={()=>{setFilterType('all');setFilterBy('all')}}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border-2 transition ${filterType==='all'?'bg-green-700 border-green-700 text-white':'bg-white border-gray-200 text-gray-600 hover:border-green-400'}`}>
                All
              </button>
            </div>

            {/* By Department */}
            {departments.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">Dept:</span>
                {departments.map(dept => {
                  const color = deptColor(dept)
                  const active = filterType==='dept' && filterBy===dept
                  return (
                    <button key={dept} onClick={()=>{setFilterType('dept');setFilterBy(dept)}}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border-2 transition ${active ? `${color.active} border-transparent` : `bg-white border-gray-200 text-gray-600 hover:border-gray-400`}`}>
                      {dept}
                    </button>
                  )
                })}
              </div>
            )}

            {/* By Instructor */}
            {instructors.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">Instructor:</span>
                {instructors.map(i => (
                  <button key={i.id} onClick={()=>{setFilterType('instructor');setFilterBy(i.id)}}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border-2 transition ${filterType==='instructor'&&filterBy===i.id?'bg-green-700 border-green-700 text-white':'bg-white border-gray-200 text-gray-600 hover:border-green-400'}`}>
                    {i.name.split(' ').pop()}
                  </button>
                ))}
              </div>
            )}

            {/* By Section */}
            {sections.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">Section:</span>
                {sections.map(s => (
                  <button key={s} onClick={()=>{setFilterType('section');setFilterBy(s)}}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border-2 transition ${filterType==='section'&&filterBy===s?'bg-blue-600 border-blue-600 text-white':'bg-white border-gray-200 text-gray-600 hover:border-blue-400'}`}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* By Room */}
            {roomList.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">Room:</span>
                {roomList.map(r => (
                  <button key={r.id} onClick={()=>{setFilterType('room');setFilterBy(r.id)}}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border-2 transition ${filterType==='room'&&filterBy===r.id?'bg-amber-500 border-amber-500 text-white':'bg-white border-gray-200 text-gray-600 hover:border-amber-400'}`}>
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timetable */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2"/> Loading...
        </div>
      ) : schedules.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-24 text-gray-400">
          <Cpu className="w-14 h-14 mb-4 opacity-20"/>
          <p className="font-semibold text-gray-500 text-base">No schedule generated yet.</p>
          <p className="text-sm mt-1">Click <strong className="text-green-700">Generate Schedule</strong> to run the AI scheduling engine.</p>
          <p className="text-xs mt-2 text-amber-600">Requires rooms in Manage Rooms and faculty load entries from the Program Chair.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden print:shadow-none">
          <div className="overflow-x-auto">
            <div style={{ minWidth: 900 }}>
              {/* Day headers */}
              <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: '60px repeat(6,1fr)' }}>
                <div className="py-2 text-xs text-gray-400 font-semibold text-center border-r border-gray-100"></div>
                {DAYS.map(d => (
                  <div key={d} className="py-2 text-xs font-bold text-center text-gray-700 border-r border-gray-100 last:border-0">{DAY_SHORT[d]}</div>
                ))}
              </div>

              {/* Grid body */}
              <div className="grid" style={{ gridTemplateColumns: '60px repeat(6,1fr)' }}>
                {/* Time labels */}
                <div className="relative" style={{ height: GRID_HEIGHT }}>
                  {HOUR_LABELS.map(h => (
                    <div key={h} className="absolute w-full flex items-start justify-end pr-2"
                      style={{ top: (h * 60 - GRID_START) * PX_PER_MIN - 8 }}>
                      <span className="text-[10px] text-gray-400 font-medium">
                        {h === 12 ? '12PM' : h < 12 ? `${h}AM` : `${h-12}PM`}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {DAYS.map(day => (
                  <div key={day} className="relative border-l border-gray-100" style={{ height: GRID_HEIGHT }}>
                    {/* Hour grid lines */}
                    {HOUR_LABELS.map(h => (
                      <div key={h} className="absolute w-full border-t border-gray-100"
                        style={{ top: (h * 60 - GRID_START) * PX_PER_MIN }} />
                    ))}
                    {/* Lunch break shading */}
                    <div className="absolute w-full bg-gray-50 opacity-80"
                      style={{ top:(720-GRID_START)*PX_PER_MIN, height:60*PX_PER_MIN }} />

                    {/* Schedule blocks */}
                    {byDay[day].map(slot => (
                      <ScheduleBlock key={`${slot.id}-${day}`} slot={slot} onEdit={setEditSlot} />
                    ))}
                  </div>
                ))}
              </div>

              {/* Lunch label */}
              <div className="flex border-t border-gray-100">
                <div style={{width:60}} className="shrink-0" />
                <div className="flex-1 py-0.5 text-center text-[10px] text-gray-400 font-medium bg-gray-50 border-l border-gray-100">
                  LUNCH BREAK (12:00 – 1:00 PM)
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      {schedules.length > 0 && (
        <div className="flex flex-wrap gap-4 mt-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-l-2 bg-green-100 border-green-500"/>&nbsp;Lecture</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-l-2 bg-blue-100 border-blue-500"/>&nbsp;Lab</span>
          <span className="flex items-center gap-1.5"><span className="text-red-500 font-bold">CONFLICT</span>&nbsp;= scheduling conflict (click to fix)</span>
          <span className="flex items-center gap-1.5"><span className="bg-amber-400 rounded px-1 text-[8px] font-bold text-green-900">M</span>&nbsp;= manual override</span>
          <span className="ml-auto">Click any block to edit room / time</span>
        </div>
      )}

      {/* Edit modal */}
      {editSlot && (
        <EditModal
          slot={editSlot}
          rooms={rooms}
          onSave={() => { setEditSlot(null); fetchSchedules() }}
          onClose={() => setEditSlot(null)}
        />
      )}

      {/* Print styles */}
      <style>{`@media print { .print\\:shadow-none { box-shadow: none !important; } button, [role=button] { display: none !important; } }`}</style>
    </div>
  )
}
