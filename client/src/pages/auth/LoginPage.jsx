import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, ROLES } from '../../context/AuthContext.jsx'
import { authAPI } from '../../services/api.js'
import toast from 'react-hot-toast'
import { GraduationCap, Eye, EyeOff, Loader2 } from 'lucide-react'

const ROLE_PATHS = {
  [ROLES.CHAIR]:             '/chair',
  [ROLES.DEAN]:              '/dean',
  [ROLES.QUALITY_ASSURANCE]: '/qa',
  [ROLES.VPAA]:              '/vpaa',
  [ROLES.ADMIN]:             '/admin',
  [ROLES.INSTRUCTOR]:        '/instructor',
  [ROLES.STUDENT]:           '/student',
}

const QUICK_LOGINS = [
  { label: 'Admin',        username: 'admin',      password: 'admin123' },
  { label: 'Program Chair',username: 'chair',      password: 'chair123' },
  { label: 'Dean',         username: 'dean',       password: 'dean123'  },
  { label: 'Quality Assurance', username: 'qa',    password: 'qa123'    },
  { label: 'VPAA',         username: 'vpaa',       password: 'vpaa123'  },
  { label: 'Instructor',   username: 'instructor', password: 'instr123' },
  { label: 'Student',      username: 'student',    password: 'stud123'  },
]

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm]       = useState({ username: '', password: '' })
  const [showPw, setShowPw]   = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await authAPI.login(form)
      const { token, user } = res.data
      login({ ...user, token })
      toast.success(`Welcome, ${user.name}!`)
      navigate(ROLE_PATHS[user.role] || '/login')
    } catch (err) {
      const msg = err.response?.data?.message || 'Login failed. Please try again.'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-900 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #fbbf24 0%, transparent 50%), radial-gradient(circle at 80% 20%, #fbbf24 0%, transparent 40%)' }}
      />

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-amber-400 rounded-2xl mb-4 shadow-xl">
            <GraduationCap className="w-11 h-11 text-green-900" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">ADSSU</h1>
          <p className="text-amber-300 font-semibold text-sm mt-1">AI-Powered Room Scheduling System</p>
          <p className="text-green-300 text-xs mt-1">Agusan del Sur State University</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-green-800 px-8 py-4">
            <p className="text-white font-semibold text-base">Sign in to your account</p>
            <p className="text-green-300 text-xs mt-0.5">Enter your credentials to continue</p>
          </div>

          <div className="px-8 py-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Username</label>
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-600 transition"
                  placeholder="Enter your username"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 pr-11 text-sm text-gray-800 focus:outline-none focus:border-green-600 transition"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition shadow-md flex items-center justify-center gap-2 text-sm mt-2"
              >
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : 'Sign In'}
              </button>
            </form>

            {/* Quick demo logins */}
            <div className="mt-5 border-t border-gray-100 pt-4">
              <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">Quick Demo Login</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_LOGINS.map(q => (
                  <button
                    key={q.username}
                    type="button"
                    onClick={() => setForm({ username: q.username, password: q.password })}
                    className="text-xs bg-gray-100 hover:bg-amber-50 hover:border-amber-300 border border-gray-200 text-gray-600 hover:text-green-800 px-3 py-1.5 rounded-lg transition font-medium"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="text-center text-green-400 text-xs mt-6">
          &copy; 2026 Agusan del Sur State University · All Rights Reserved
        </p>
      </div>
    </div>
  )
}
