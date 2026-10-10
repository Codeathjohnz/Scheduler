import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader.jsx'
import StatCard from '../../components/ui/StatCard.jsx'
import NotificationBox from '../../components/common/NotificationBox.jsx'
import { geCoordinatorAPI, facultyLoadAPI } from '../../services/api.js'
import { creditOf } from '../../utils/unitCredit.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Loader2, Check, ArrowRight, Users, Inbox, CheckCircle2 } from 'lucide-react'

const SEM = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' }

function Row({ r, instructors, busy, onAssign }) {
  const [pickId, setPickId] = useState('')
  const picked = instructors.find(i => String(i.id) === String(pickId))
  const add = creditOf(r)
  const projected = picked ? picked.current_units + add : null
  const willExceed = picked && projected > 27

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono font-bold text-sm text-green-800">{r.course_code} <span className="font-sans font-normal text-gray-700">— {r.descriptive_title}</span></p>
          <p className="text-xs text-gray-500 mt-0.5">{r.program_yr_sec} · {add.toFixed(2)} unit credit</p>
        </div>
        <span className="text-xs font-semibold text-gray-500">{r.chair_department} <span className="text-gray-400">· {r.chair_name}</span></span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={pickId} onChange={e => setPickId(e.target.value)}
          className="flex-1 min-w-[220px] border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-green-500">
          <option value="">— Pick a GE instructor —</option>
          {instructors.map(i => (
            <option key={i.id} value={i.id}>{i.name} — {i.current_units.toFixed(2)} units loaded</option>
          ))}
        </select>
        <button disabled={busy || !pickId || willExceed} onClick={() => onAssign(pickId)}
          className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-semibold rounded-lg text-sm">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Assign
        </button>
      </div>
      {picked && (
        <p className={`text-xs ${willExceed ? 'text-red-700' : 'text-gray-500'}`}>
          {picked.name}: {picked.current_units.toFixed(2)} <ArrowRight className="inline w-3 h-3 -mt-0.5" /> {projected.toFixed(2)} units
          {willExceed && ' — over the 27-unit cap, pick someone else.'}
        </p>
      )}
    </div>
  )
}

export default function GECoordinatorDashboard() {
  const { user } = useAuth()
  const [year, setYear] = useState('2026-2027')
  const [semester, setSemester] = useState(1)
  const [queue, setQueue] = useState([])
  const [instructors, setInstructors] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [q, all] = await Promise.all([
        geCoordinatorAPI.queue(year, semester),
        facultyLoadAPI.getAllInstructors(year, semester),
      ])
      setQueue(q.data)
      setInstructors(all.data.filter(i => i.department === 'General Education'))
    } catch {
      toast.error('Failed to load the GE queue.')
    } finally {
      setLoading(false)
    }
  }, [year, semester])

  useEffect(() => { load() }, [load])

  const assign = async (entryId, instructorId) => {
    setBusyId(entryId)
    try {
      const res = await geCoordinatorAPI.assign(entryId, instructorId)
      toast.success(res.data.message, { duration: 5000 })
      await load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not assign.', { duration: 6000 })
    } finally {
      setBusyId(null)
    }
  }

  // Group the queue by college, so one college's backlog doesn't bury another's.
  const byCollege = {}
  for (const r of queue) {
    const k = r.chair_department || '—'
    if (!byCollege[k]) byCollege[k] = []
    byCollege[k].push(r)
  }
  const colleges = Object.keys(byCollege).sort()

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name}`}
        subtitle="Assign a GE instructor to every college's General Education subjects. A chair adds the subject and section; you pick who teaches it."
      />
      <NotificationBox />

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Academic year</label>
          <input value={year} onChange={e => setYear(e.target.value)}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
          <select value={semester} onChange={e => setSemester(Number(e.target.value))}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-green-500">
            {Object.entries(SEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Unassigned GE Subjects" value={String(queue.length)} icon={Inbox} color="gold" />
        <StatCard label="Colleges Waiting"        value={String(colleges.length)} icon={Users} color="teal" />
        <StatCard label="GE Instructors"          value={String(instructors.length)} icon={CheckCircle2} color="green" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…</div>
      ) : queue.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center py-14 text-gray-400">
          <CheckCircle2 className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">Every college's GE subjects for this term are assigned.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {colleges.map(college => (
            <section key={college}>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">{college} ({byCollege[college].length})</h2>
              <div className="space-y-2">
                {byCollege[college].map(r => (
                  <Row key={r.id} r={r} instructors={instructors} busy={busyId === r.id}
                    onAssign={(instructorId) => assign(r.id, instructorId)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
