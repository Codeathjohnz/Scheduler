import { Outlet } from 'react-router-dom'
import Sidebar from '../components/common/Sidebar.jsx'
import { LayoutDashboard, CalendarDays, Accessibility, GraduationCap, Briefcase, CheckSquare, ClipboardList } from 'lucide-react'

const nav = [
  { to: '/instructor', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/instructor/schedule', icon: CalendarDays, label: 'My Schedule' },
  { to: '/instructor/my-load', icon: ClipboardList, label: 'My Faculty Load' },
  { to: '/instructor/confirm-load', icon: CheckSquare, label: 'Confirm My Load' },
  { to: '/instructor/specialty', icon: GraduationCap, label: 'My Specialty' },
  { to: '/instructor/load-request', icon: Briefcase, label: 'Load Request' },
  { to: '/instructor/accessibility', icon: Accessibility, label: 'Accessibility Request' },
]

export default function InstructorLayout() {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar navItems={nav} roleLabel="Instructor" />
      <main className="flex-1 p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
