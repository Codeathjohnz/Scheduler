import { Outlet } from 'react-router-dom'
import Sidebar from '../components/common/Sidebar.jsx'
import { LayoutDashboard, ClipboardCheck, GraduationCap, Accessibility, CheckSquare } from 'lucide-react'

const nav = [
  { to: '/dean', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dean/review', icon: ClipboardCheck, label: 'Review Submissions' },
  { to: '/dean/confirm-load', icon: CheckSquare, label: 'Confirm My Load' },
  { to: '/dean/specialty', icon: GraduationCap, label: 'My Specialty' },
  { to: '/dean/accessibility', icon: Accessibility, label: 'Accessibility Request' },
]

export default function DeanLayout() {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar navItems={nav} roleLabel="Dean" />
      <main className="flex-1 p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
