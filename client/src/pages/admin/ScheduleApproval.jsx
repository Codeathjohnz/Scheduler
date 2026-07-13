import { useState } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { CheckCircle, XCircle, RefreshCw } from 'lucide-react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

const generatedSchedule = [
  { id: 1, subject: 'IS 102', section: 'BSIS 1A', instructor: 'Michelle Elape', room: 'CEIT 107', day: 'Mon', time: '8:00–9:30 AM', status: 'Pending' },
  { id: 2, subject: 'IS 102', section: 'BSIS 1B', instructor: 'Michelle Elape', room: 'CEIT 107', day: 'Tue', time: '10:00–11:30 AM', status: 'Pending' },
  { id: 3, subject: 'ITCC 102', section: 'BSIS 2A', instructor: 'Ignel Balmora', room: 'CEIT 207', day: 'Mon', time: '10:00–11:30 AM', status: 'Pending' },
  { id: 4, subject: 'IS 101', section: 'BSIS 1A', instructor: 'Nancy Jacobsen', room: 'CEIT 208', day: 'Wed', time: '1:00–2:30 PM', status: 'Pending' },
  { id: 5, subject: 'GE 09', section: 'BSIS 1B', instructor: 'Novie Balighot', room: 'CEIT 209', day: 'Thu', time: '3:00–4:30 PM', status: 'Pending' },
]

const STATUS_STYLE = {
  Pending: 'bg-yellow-100 text-yellow-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
}

export default function AdminScheduleApproval() {
  const [schedules, setSchedules] = useState(generatedSchedule)

  const act = (id, status) => {
    setSchedules(s => s.map(item => item.id === id ? { ...item, status } : item))
    toast.success(status === 'Approved' ? 'Schedule entry approved.' : 'Schedule entry rejected.')
  }

  const approveAll = () => {
    setSchedules(s => s.map(item => ({ ...item, status: 'Approved' })))
    toast.success('All schedules approved and published!')
  }

  const allApproved = schedules.every(s => s.status === 'Approved')

  return (
    <div>
      <PageHeader
        title="Schedule Approval"
        subtitle="Review AI-generated schedules. Approve, reject, or publish final timetables."
        action={
          !allApproved && (
            <button onClick={approveAll}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
              Approve All & Publish
            </button>
          )
        }
      />

      {allApproved && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 text-green-800 font-medium text-sm">
          All schedules approved and published to instructors and students.
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Subject</th>
              <th className="px-4 py-3 text-left">Section</th>
              <th className="px-4 py-3 text-left">Instructor</th>
              <th className="px-4 py-3 text-left">Room</th>
              <th className="px-4 py-3 text-left">Day</th>
              <th className="px-4 py-3 text-left">Time</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {schedules.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-700">{s.subject}</td>
                <td className="px-4 py-3 text-gray-600">{s.section}</td>
                <td className="px-4 py-3 text-gray-600">{s.instructor}</td>
                <td className="px-4 py-3 text-gray-500">{s.room}</td>
                <td className="px-4 py-3 text-gray-500">{s.day}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{s.time}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_STYLE[s.status]}`}>{s.status}</span>
                </td>
                <td className="px-4 py-3">
                  {s.status === 'Pending' && (
                    <div className="flex gap-2">
                      <button onClick={() => act(s.id, 'Approved')} className="text-green-500 hover:text-green-700"><CheckCircle className="w-4 h-4" /></button>
                      <button onClick={() => act(s.id, 'Rejected')} className="text-red-400 hover:text-red-600"><XCircle className="w-4 h-4" /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
