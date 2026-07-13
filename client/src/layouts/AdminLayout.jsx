import { Outlet } from 'react-router-dom'
import Sidebar from '../components/common/Sidebar.jsx'
import { LayoutDashboard, ShieldCheck, DoorOpen, Accessibility, Users, CalendarClock } from 'lucide-react'

const nav = [
  { to: '/admin',                    icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/users',              icon: Users,           label: 'User Management' },
  { to: '/admin/validation',         icon: ShieldCheck,     label: 'Validate Data' },
  { to: '/admin/rooms',              icon: DoorOpen,        label: 'Manage Rooms' },
  { to: '/admin/schedule-generator', icon: CalendarClock,   label: 'Schedule Generator' },
  { to: '/admin/accessibility',      icon: Accessibility,   label: 'Accessibility Requests' },
]

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar navItems={nav} roleLabel="Admin / Registrar" />
      <main className="flex-1 p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
