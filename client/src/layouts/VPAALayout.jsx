import { Outlet } from 'react-router-dom'
import Sidebar from '../components/common/Sidebar.jsx'
import { LayoutDashboard, ClipboardCheck, PenTool } from 'lucide-react'

const nav = [
  { to: '/vpaa', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/vpaa/review', icon: ClipboardCheck, label: 'Review Submissions' },
  { to: '/vpaa/signature', icon: PenTool, label: 'My E-Signature' },
]

export default function VPAALayout() {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar navItems={nav} roleLabel="Vice President for Academic Affairs" />
      <main className="flex-1 p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
