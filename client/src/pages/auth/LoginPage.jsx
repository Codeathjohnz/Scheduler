import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, ROLES } from '../../context/AuthContext.jsx'
import { authAPI } from '../../services/api.js'
import toast from 'react-hot-toast'
import { User, Lock, Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react'
import adssuLogo from '../../assets/adssu-logo.png'

const ROLE_PATHS = {
  [ROLES.CHAIR]:             '/chair',
  [ROLES.DEAN]:              '/dean',
  [ROLES.CHIEF_CPD]:         '/chief-cpd',
  [ROLES.QUALITY_ASSURANCE]: '/qa',
  [ROLES.VPAA]:              '/vpaa',
  [ROLES.ADMIN]:             '/admin',
  [ROLES.INSTRUCTOR]:        '/instructor',
  [ROLES.STUDENT]:           '/student',
}

function LogoMark({ size = 'w-16 h-16' }) {
  return (
    <div className={`${size} rounded-full bg-white shadow-md flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-black/5`}>
      <img src={adssuLogo} alt="ADSSU seal" className="w-[85%] h-[85%] object-contain" />
    </div>
  )
}

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm]       = useState({ username: '', password: '' })
  const [remember, setRemember] = useState(true)
  const [showPw, setShowPw]   = useState(false)
  const [loading, setLoading] = useState(false)
  // reCAPTCHA ("I'm not a robot"): site key comes from the server at runtime.
  const [captchaKey, setCaptchaKey] = useState(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const captchaRef = useRef(null)

  useEffect(() => {
    authAPI.captchaConfig().then(r => {
      if (!r.data.siteKey) return
      setCaptchaKey(r.data.siteKey)
      const render = () => {
        if (captchaRef.current && !captchaRef.current.dataset.rendered) {
          captchaRef.current.dataset.rendered = '1'
          window.grecaptcha.render(captchaRef.current, {
            sitekey: r.data.siteKey,
            callback: (t) => setCaptchaToken(t),
            'expired-callback': () => setCaptchaToken(''),
          })
        }
      }
      if (window.grecaptcha?.render) return render()
      window.__recaptchaReady = render
      const script = document.createElement('script')
      script.src = 'https://www.google.com/recaptcha/api.js?onload=__recaptchaReady&render=explicit'
      script.async = true
      document.head.appendChild(script)
    }).catch(() => {})
  }, [])

  // Google sign-in comes back as /login#google=<payload> (or /login?error=...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error')) {
      toast.error(params.get('error'))
      window.history.replaceState(null, '', '/login')
    }
    const hash = window.location.hash
    if (hash.startsWith('#google=')) {
      try {
        const { token, user } = JSON.parse(atob(hash.slice('#google='.length).replace(/-/g, '+').replace(/_/g, '/')))
        window.history.replaceState(null, '', '/login')
        login({ ...user, token }, true)
        toast.success(`Welcome, ${user.name}!`)
        navigate(ROLE_PATHS[user.role] || '/login')
      } catch {
        toast.error('Google sign-in failed. Please try again.')
      }
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await authAPI.login({ ...form, captcha: captchaToken })
      const { token, user } = res.data
      login({ ...user, token }, remember)
      toast.success(`Welcome, ${user.name}!`)
      navigate(ROLE_PATHS[user.role] || '/login')
    } catch (err) {
      const msg = err.response?.data?.message || 'Login failed. Please try again.'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = () => {
    toast('Password resets go through your administrator — reach out to the Registrar\'s Office or your Program Chair.', { icon: '🔑', duration: 6000 })
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2 bg-amber-50">
      {/* ── Left panel — brand, desktop only ── */}
      <div className="hidden lg:flex relative flex-col justify-between overflow-hidden bg-gradient-to-br from-green-900 via-green-800 to-green-900 px-12 py-10">
        <div
          className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 15% 20%, #fbbf24 0%, transparent 45%), radial-gradient(circle at 85% 80%, #fbbf24 0%, transparent 40%)' }}
        />
        {/* Oversized watermark seal for texture, mirrors the coffee-cup-photo treatment without needing a campus photo asset */}
        <img
          src={adssuLogo}
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute -right-24 -bottom-16 w-[30rem] h-[30rem] object-contain opacity-[0.08]"
        />

        <div className="relative flex items-center gap-3">
          <LogoMark size="w-12 h-12" />
          <div>
            <p className="text-white font-bold text-sm leading-tight tracking-wide">ADSSU</p>
            <p className="text-green-300 text-xs">Room Scheduling System</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl xl:text-5xl font-bold text-amber-400 leading-tight tracking-tight">
            Smarter Scheduling.<br />Zero Conflicts.
          </h2>
          <p className="text-green-200 text-sm mt-6 leading-relaxed">
            AI-Powered Room Scheduling &amp; Conflict-Aware Management Platform
          </p>
        </div>

        <p className="relative text-green-400 text-xs">
          &copy; 2026 Agusan del Sur State University · All Rights Reserved
        </p>
      </div>

      {/* ── Right panel — sign-in card ── */}
      <div className="flex items-center justify-center p-4 py-10 lg:py-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl px-8 py-10">
          <div className="flex flex-col items-center text-center mb-6">
            <LogoMark />
            <p className="text-green-900 font-bold text-lg mt-3 tracking-tight">ADSSU</p>
            <p className="text-gray-400 text-xs uppercase tracking-widest">Room Scheduling System</p>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 text-center">Welcome Back</h1>
          <p className="text-gray-500 text-sm text-center mt-1 mb-7">Sign in to continue to your account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Username</label>
              <div className="relative">
                <User className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-600 transition"
                  placeholder="Enter your username"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-11 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-green-600 transition"
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

            <div className="flex items-center justify-between text-sm pt-0.5">
              <label className="flex items-center gap-2 text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                  className="w-4 h-4 accent-green-700 rounded"
                />
                Remember me
              </label>
              <button type="button" onClick={handleForgotPassword} className="text-green-700 font-semibold hover:text-green-800 hover:underline">
                Forgot Password?
              </button>
            </div>

            {captchaKey && <div ref={captchaRef} className="flex justify-center" />}
            <button
              type="submit"
              disabled={loading || (!!captchaKey && !captchaToken)}
              className="w-full bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition shadow-md flex items-center justify-center gap-2 text-sm mt-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : <>Sign In <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <a href="/api/auth/google"
            className="w-full flex items-center justify-center gap-3 border-2 border-gray-200 hover:border-green-500 bg-white text-gray-700 font-semibold py-3 rounded-xl transition text-sm">
            <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
            </svg>
            Continue with Google
          </a>
          <p className="text-[11px] text-gray-400 text-center mt-2">Use your @adssu.edu.ph account.</p>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-gray-400 text-xs font-medium">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <p className="text-center text-gray-500 text-xs leading-relaxed">
            New to ADSSU? Accounts are provisioned by your <span className="font-semibold text-gray-700">Program Chair, Dean, or the Registrar's Office</span> — reach out to them for access.
          </p>
        </div>
      </div>
    </div>
  )
}
