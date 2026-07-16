import { Outlet } from 'react-router-dom'
import Sidebar from '../components/common/Sidebar.jsx'
import { LayoutDashboard, ClipboardCheck } from 'lucide-react'

const nav = [
  { to: '/qa', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/qa/review', icon: ClipboardCheck, label: 'Review Submissions' },
]

export default function QALayout() {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar navItems={nav} roleLabel="Quality Assurance" />
      <main className="flex-1 p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
