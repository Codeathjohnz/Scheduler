import { Outlet } from 'react-router-dom'
import Sidebar from '../components/common/Sidebar.jsx'
import { LayoutDashboard, ClipboardCheck, PenTool , Bell} from 'lucide-react'

const nav = [
  { to: '/chief-cpd', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/chief-cpd/review', icon: ClipboardCheck, label: 'Review Submissions' },
  { to: '/chief-cpd/signature', icon: PenTool, label: 'My E-Signature' },
  { to: '/chief-cpd/notifications', icon: Bell, label: 'Notifications' },
]

export default function ChiefCPDLayout() {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar navItems={nav} roleLabel="Chief Curriculum Planning and Development" />
      <main className="flex-1 p-8 overflow-y-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
