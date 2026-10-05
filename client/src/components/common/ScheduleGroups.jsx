import { DoorOpen } from 'lucide-react'
import RoomTypeBadge from './RoomTypeBadge.jsx'

/**
 * A schedule arranged in groups instead of one long list.
 *   mode="building"   — one card per building, and within it one table per room
 *                       (so the registrar or chair can see which room is taken when)
 *   mode="instructor" — one card per instructor, their classes in day/time order
 */
const DAY_ORDER = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' }

const hhmm = (t) => String(t || '').slice(0, 5)
const fmt = (t) => {
  const [h, m] = hhmm(t).split(':').map(Number)
  if (Number.isNaN(h)) return ''
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`
}
const firstDay = (days) => {
  const list = String(days || '').split(',').map(d => d.trim()).filter(Boolean)
  return list.sort((a, b) => (DAY_ORDER[a] || 9) - (DAY_ORDER[b] || 9))
}
const daysText = (days) => firstDay(days).map(d => DAY_SHORT[d] || d).join('/')
const dayKey = (s) => DAY_ORDER[firstDay(s.days)[0]] || 9
const sortRows = (rows) => [...rows].sort((a, b) =>
  dayKey(a) - dayKey(b) || hhmm(a.start_time).localeCompare(hhmm(b.start_time)))

const group = (rows, keyOf) => {
  const map = new Map()
  for (const r of rows) {
    const k = keyOf(r)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return [...map.entries()]
}

function SessionLine({ s }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2 text-xs font-semibold text-gray-700 whitespace-nowrap">{daysText(s.days)}</td>
      <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{fmt(s.start_time)} – {fmt(s.end_time)}</td>
      <td className="px-3 py-2 text-xs"><span className="font-mono font-bold text-green-800">{s.course_code}</span> <span className="text-gray-500">{s.program_yr_sec}</span></td>
      <td className="px-3 py-2 text-xs text-gray-700">{s.instructor_name || '—'}</td>
      <td className="px-3 py-2 text-xs"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.session_type === 'lab' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{s.session_type === 'lab' ? 'LAB' : 'LEC'}</span></td>
    </tr>
  )
}

export function ScheduleGroups({ rows, mode }) {
  if (mode === 'instructor') {
    const groups = group(sortRows(rows), r => r.instructor_name || 'No instructor yet')
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map(([name, items]) => (
          <section key={name} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-green-800 text-white">
              <p className="font-bold text-sm">{name}</p>
              <p className="text-xs text-green-200">{items.length} session{items.length === 1 ? '' : 's'}</p>
            </div>
            <table className="w-full">
              <tbody>
                {items.map(s => <SessionLine key={s.id} s={{ ...s, instructor_name: s.room_name || '—' }} />)}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    )
  }

  // by building, then room
  const buildings = group(rows, r => r.building || 'Online classes')
  return (
    <div className="space-y-5">
      {buildings.map(([building, items]) => {
        const rooms = group(sortRows(items), r => r.room_name || 'No room')
        return (
          <section key={building} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-green-800 text-white">
              <p className="font-bold text-sm">{building}</p>
              <p className="text-xs text-green-200">{rooms.length} room{rooms.length === 1 ? '' : 's'} · {items.length} session{items.length === 1 ? '' : 's'}</p>
            </div>
            <div className="divide-y divide-gray-100">
              {rooms.map(([room, sessions]) => (
                <div key={room} className="px-5 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <DoorOpen className="w-4 h-4 text-gray-400" />
                    <p className="font-semibold text-sm text-gray-800">{room}</p>
                    <RoomTypeBadge type={sessions[0].room_type} />
                  </div>
                  <table className="w-full rounded-lg overflow-hidden border border-gray-100">
                    <tbody>
                      {sessions.map(s => <SessionLine key={s.id} s={s} />)}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export default ScheduleGroups
