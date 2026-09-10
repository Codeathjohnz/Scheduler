import { Outlet } from 'react-router-dom'
import Sidebar from '../components/common/Sidebar.jsx'
import { LayoutDashboard, CalendarDays, BookOpen, Briefcase, GraduationCap, Accessibility, CheckSquare, ClipboardList } from 'lucide-react'

const nav = [
  { to: '/chair', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/chair/faculty-load', icon: BookOpen, label: 'Faculty Load' },
  { to: '/chair/load-requests', icon: Briefcase, label: 'Load Requests' },
  { to: '/chair/schedule', icon: CalendarDays, label: 'View Schedules' },
  { to: '/chair/my-load', icon: ClipboardList, label: 'My Faculty Load' },
  { to: '/chair/confirm-load', icon: CheckSquare, label: 'Confirm My Load' },
  { to: '/chair/specialty', icon: GraduationCap, label: 'My Specialty' },
  { to: '/chair/accessibility', icon: Accessibility, label: 'Accessibility Request' },
]

export default function ChairLayout() {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar navItems={nav} roleLabel="Program Chair" />
      <main className="flex-1 p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
