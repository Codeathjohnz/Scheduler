import { useState, useEffect } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { DoorOpen, RefreshCw } from 'lucide-react'

const ROOMS = [
  { id: 1, name: 'CEIT 107', floor: 1, capacity: 50, type: 'Lecture' },
  { id: 2, name: 'CEIT 207', floor: 2, capacity: 50, type: 'Lecture' },
  { id: 3, name: 'CEIT 208', floor: 2, capacity: 50, type: 'Lecture' },
  { id: 4, name: 'CEIT 209', floor: 2, capacity: 50, type: 'Lecture' },
  { id: 5, name: 'CEIT Lab 1', floor: 1, capacity: 40, type: 'Laboratory' },
  { id: 6, name: 'CEIT Lab 2', floor: 1, capacity: 40, type: 'Laboratory' },
]

const randomStatus = () => Math.random() > 0.4 ? 'Available' : 'Occupied'

export default function AdminRealTimeRooms() {
  const [statuses, setStatuses] = useState(() => Object.fromEntries(ROOMS.map(r => [r.id, randomStatus()])))
  const [lastUpdated, setLastUpdated] = useState(new Date())

  const refresh = () => {
    setStatuses(Object.fromEntries(ROOMS.map(r => [r.id, randomStatus()])))
    setLastUpdated(new Date())
  }

  useEffect(() => {
    const interval = setInterval(refresh, 30000)
    return () => clearInterval(interval)
  }, [])

  const available = ROOMS.filter(r => statuses[r.id] === 'Available').length
  const occupied = ROOMS.length - available

  return (
    <div>
      <PageHeader
        title="Real-Time Room Availability"
        subtitle={`Last updated: ${lastUpdated.toLocaleTimeString()}`}
        action={
          <button onClick={refresh}
            className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className="flex gap-4 mb-6">
        <div className="bg-green-50 border border-green-200 rounded-lg px-5 py-3 flex items-center gap-3">
          <DoorOpen className="w-5 h-5 text-green-600" />
          <div>
            <p className="text-xl font-bold text-green-700">{available}</p>
            <p className="text-xs text-green-600">Available</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-3 flex items-center gap-3">
          <DoorOpen className="w-5 h-5 text-red-500" />
          <div>
            <p className="text-xl font-bold text-red-600">{occupied}</p>
            <p className="text-xs text-red-500">Occupied</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ROOMS.map(room => {
          const status = statuses[room.id]
          const isAvailable = status === 'Available'
          return (
            <div key={room.id} className={`rounded-xl border p-5 transition-all ${isAvailable ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800">{room.name}</h3>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${isAvailable ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                  {status}
                </span>
              </div>
              <p className="text-xs text-gray-500">Floor {room.floor} · {room.type} · Capacity: {room.capacity}</p>
              <div className={`mt-3 h-2 rounded-full ${isAvailable ? 'bg-green-200' : 'bg-red-200'}`}>
                <div className={`h-2 rounded-full ${isAvailable ? 'bg-green-500 w-0' : 'bg-red-500 w-full'}`} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
