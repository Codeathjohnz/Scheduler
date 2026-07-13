import { Outlet } from 'react-router-dom'
import Sidebar from '../components/common/Sidebar.jsx'
import { LayoutDashboard, CalendarDays } from 'lucide-react'

const nav = [
  { to: '/student', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/student/schedule', icon: CalendarDays, label: 'My Class Schedule' },
]

export default function StudentLayout() {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar navItems={nav} roleLabel="Student" />
      <main className="flex-1 p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
