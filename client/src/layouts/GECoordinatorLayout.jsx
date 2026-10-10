import { Outlet } from 'react-router-dom'
import Sidebar from '../components/common/Sidebar.jsx'
import { LayoutDashboard, Bell } from 'lucide-react'

const nav = [
  { to: '/ge-coordinator', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/ge-coordinator/notifications', icon: Bell, label: 'Notifications' },
]

export default function GECoordinatorLayout() {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar navItems={nav} roleLabel="GE Coordinator" />
      <main className="flex-1 p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
