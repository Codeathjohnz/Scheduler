import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Cpu, DoorOpen, AlertTriangle, CalendarCheck,
  Users, BookOpen, Loader2, RefreshCw,
  FileCheck, Accessibility, Radio, Clock
} from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import api from '../../services/api.js'
import NotificationBox from '../../components/common/NotificationBox.jsx'

const TYPE_STYLE = {
  submission:   'bg-blue-50 border-blue-100 text-blue-800',
  accessibility:'bg-purple-50 border-purple-100 text-purple-800',
  schedule:     'bg-green-50 border-green-100 text-green-800',
  user:         'bg-amber-50 border-amber-100 text-amber-800',
}
const TYPE_LABEL = {
  submission:    'Submission',
  accessibility: 'Accessibility',
  schedule:      'Schedule',
  user:          'User',
}

function timeAgo(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60)   return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function StatCard({ label, value, icon: Icon, colorClass, loading }) {
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-3 ${colorClass}`}>
      <div className="flex items-center justify-between">
        <Icon className="w-5 h-5 opacity-70" />
        {loading
          ? <div className="w-8 h-7 bg-current opacity-10 rounded animate-pulse" />
          : <span className="text-2xl font-bold">{value ?? '—'}</span>
        }
      </div>
      <p className="text-xs font-semibold opacity-70 leading-tight">{label}</p>
    </div>
  )
}

export default function AdminDashboard() {
  const { user }    = useAuth()
  const navigate    = useNavigate()
  const [year, setYear]         = useState('2026-2027')
  const [semester, setSemester] = useState(1)
  const [stats, setStats]       = useState(null)
  const [activity, setActivity] = useState([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true)
    try {
      const [sRes, aRes] = await Promise.all([
        api.get(`/admin/stats?year=${year}&semester=${semester}`),
        api.get('/admin/activity'),
      ])
      setStats(sRes.data)
      setActivity(aRes.data)
    } catch {
      // silently fail — show stale data
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [year, semester])

  useEffect(() => { load() }, [load])

  const semLabel = semester === 1 ? '1st Sem' : semester === 2 ? '2nd Sem' : 'Summer'

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name}`}
        subtitle="Admin / Registrar – Validate data, generate AI schedules, and manage room availability."
        action={
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-green-700 transition">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />
      <NotificationBox />

      {/* Term selector */}
      <div className="flex items-center gap-3 mb-5">
        <input value={year} onChange={e => setYear(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-green-500 w-32" />
        <select value={semester} onChange={e => setSemester(Number(e.target.value))}
          className="border-2 border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-green-500 bg-white">
          <option value={1}>1st Semester</option>
          <option value={2}>2nd Semester</option>
          <option value={3}>Summer</option>
        </select>
        <span className="text-xs text-gray-400">Showing stats for A.Y. {year} – {semLabel}</span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Rooms"           value={stats?.total_rooms}          icon={DoorOpen}      colorClass="bg-teal-50   border-teal-100   text-teal-800"   loading={loading} />
        <StatCard label="Available Now"         value={stats?.available_rooms}      icon={Radio}         colorClass="bg-green-50  border-green-100  text-green-800"  loading={loading} />
        <StatCard label="Occupied Now"          value={stats?.occupied_rooms}       icon={DoorOpen}      colorClass="bg-red-50    border-red-100    text-red-800"    loading={loading} />
        <StatCard label="Scheduling Conflicts"  value={stats?.conflicts}            icon={AlertTriangle} colorClass="bg-amber-50  border-amber-100  text-amber-800"  loading={loading} />
        <StatCard label="Sessions Generated"    value={stats?.total_sessions}       icon={Cpu}           colorClass="bg-blue-50   border-blue-100   text-blue-800"   loading={loading} />
        <StatCard label="Sessions Published"    value={stats?.published_sessions}   icon={CalendarCheck} colorClass="bg-indigo-50 border-indigo-100 text-indigo-800" loading={loading} />
        <StatCard label="Pending Validation"    value={stats?.pending_validation}   icon={FileCheck}     colorClass="bg-orange-50 border-orange-100 text-orange-800" loading={loading} />
        <StatCard label="Instructors"           value={stats?.total_instructors}    icon={Users}         colorClass="bg-purple-50 border-purple-100 text-purple-800" loading={loading} />
        <StatCard label="Faculty Load Entries"  value={stats?.faculty_entries}      icon={BookOpen}      colorClass="bg-cyan-50   border-cyan-100   text-cyan-800"   loading={loading} />
        <StatCard label="Pending Accessibility" value={stats?.pending_accessibility} icon={Accessibility} colorClass="bg-pink-50   border-pink-100   text-pink-800"   loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="font-bold text-gray-800 text-base mb-4">Recent Activity</h2>
          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_,i) => (
                <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Clock className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No activity yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activity.map((a, i) => (
                <div key={i} className={`border rounded-xl px-4 py-3 text-sm ${TYPE_STYLE[a.type] || 'bg-gray-50 border-gray-100 text-gray-700'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold leading-snug">{a.msg}</p>
                    <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full opacity-70 ${TYPE_STYLE[a.type]}`}>
                      {TYPE_LABEL[a.type]}
                    </span>
                  </div>
                  <p className="text-xs opacity-60 mt-0.5">{timeAgo(a.ts)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Scheduling Engine */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col">
          <h2 className="font-bold text-gray-800 text-base mb-4">AI Scheduling Engine</h2>

          {/* Quick status */}
          {!loading && stats && (
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-800">{stats.faculty_entries}</p>
                <p className="text-xs text-gray-500 mt-0.5">Faculty Load Entries</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-800">{stats.total_rooms}</p>
                <p className="text-xs text-gray-500 mt-0.5">Rooms Available</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${stats.total_sessions > 0 ? 'bg-green-50' : 'bg-gray-50'}`}>
                <p className={`text-2xl font-bold ${stats.total_sessions > 0 ? 'text-green-700' : 'text-gray-400'}`}>{stats.total_sessions}</p>
                <p className="text-xs text-gray-500 mt-0.5">Sessions Generated</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${stats.conflicts > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                <p className={`text-2xl font-bold ${stats.conflicts > 0 ? 'text-red-600' : 'text-green-700'}`}>{stats.conflicts}</p>
                <p className="text-xs text-gray-500 mt-0.5">Conflicts</p>
              </div>
            </div>
          )}

          {loading && <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>}

          <div className="mt-auto space-y-2">
            {stats?.conflicts > 0 && (
              <p className="text-xs text-red-600 text-center mb-2">
                ⚠ {stats.conflicts} conflict{stats.conflicts > 1 ? 's' : ''} detected — open Schedule Generator to fix.
              </p>
            )}
            <button onClick={() => navigate('/admin/schedule-generator')}
              className="w-full bg-green-700 hover:bg-green-800 text-white font-bold py-3 rounded-xl transition shadow flex items-center justify-center gap-2">
              <Cpu className="w-4 h-4" />
              {stats?.total_sessions > 0 ? 'Open Schedule Generator' : 'Generate AI Schedule'}
            </button>
            {stats?.pending_validation > 0 && (
              <button onClick={() => navigate('/admin/validation')}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2.5 rounded-xl transition text-sm flex items-center justify-center gap-2">
                <FileCheck className="w-4 h-4" />
                {stats.pending_validation} Submission{stats.pending_validation > 1 ? 's' : ''} Need Validation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
