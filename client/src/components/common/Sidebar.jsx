import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { LogOut, KeyRound, Bell } from 'lucide-react'
import toast from 'react-hot-toast'
import ChangePasswordModal from './ChangePasswordModal.jsx'
import adssuLogo from '../../assets/adssu-logo.png'
import { notificationsAPI } from '../../services/api.js'

export default function Sidebar({ navItems, roleLabel }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [showChangePw, setShowChangePw] = useState(false)
  const [unread, setUnread] = useState(0)

  // Unread-notification count for the bell — the notifications themselves live
  // in the box on the dashboard (first nav item).
  useEffect(() => {
    let alive = true
    const poll = () => notificationsAPI.unreadCount().then(r => alive && setUnread(r.data.unread)).catch(() => {})
    poll()
    const t = setInterval(poll, 60000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const handleLogout = () => {
    logout()
    toast.success('Logged out successfully.')
    navigate('/login')
  }

  return (
    <>
      <aside className="w-64 h-screen sticky top-0 self-start bg-green-900 flex flex-col shrink-0 shadow-xl">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-green-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shrink-0 shadow overflow-hidden">
              <img src={adssuLogo} alt="ADSSU seal" className="w-[85%] h-[85%] object-contain" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm leading-tight">ADSSU</p>
              <p className="text-green-300 text-xs">Room Scheduling System</p>
            </div>
            <button onClick={() => navigate(navItems[0].to)} title={unread ? `${unread} unread notification${unread > 1 ? 's' : ''}` : 'Notifications'}
              className="relative p-2 rounded-lg text-green-200 hover:bg-green-800 hover:text-white transition shrink-0">
              <Bell className="w-4 h-4" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* User info */}
        <div className="px-5 py-4 border-b border-green-800">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center shrink-0">
              <span className="text-green-900 font-bold text-xs">{user?.name?.charAt(0)}</span>
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate">{user?.name}</p>
              <p className="text-amber-400 text-xs font-medium truncate">{roleLabel}</p>
            </div>
          </div>
          <p className="text-green-400 text-xs mt-1 truncate pl-10">{user?.department}</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to.split('/').length === 2}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-amber-400 text-green-900 shadow-sm font-semibold'
                    : 'text-green-100 hover:bg-green-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="px-3 pb-4 border-t border-green-800 pt-3 space-y-1">
          <button
            onClick={() => setShowChangePw(true)}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-green-300 hover:bg-green-700 hover:text-white transition-colors duration-150"
          >
            <KeyRound className="w-4 h-4 shrink-0" />
            Change Password
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-green-300 hover:bg-red-700 hover:text-white transition-colors duration-150"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Logout
          </button>
        </div>
      </aside>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </>
  )
}
