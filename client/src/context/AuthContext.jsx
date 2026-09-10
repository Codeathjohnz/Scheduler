import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)
const STORAGE_KEY = 'adssu_user'

export const ROLES = {
  CHAIR:             'chair',
  DEAN:              'dean',
  CHIEF_CPD:         'chief_cpd',
  QUALITY_ASSURANCE: 'quality_assurance',
  VPAA:              'vpaa',
  ADMIN:             'admin',
  INSTRUCTOR:        'instructor',
  STUDENT:           'student',
}

// "Remember me" on the login form decides WHERE the session lives:
// localStorage survives closing the browser, sessionStorage clears when the
// tab/browser closes. Checked on load (localStorage first, since that's the
// one meant to persist) so a returning user stays logged in either way.
function readStoredUser() {
  try {
    const fromLocal = localStorage.getItem(STORAGE_KEY)
    if (fromLocal) return JSON.parse(fromLocal)
    const fromSession = sessionStorage.getItem(STORAGE_KEY)
    return fromSession ? JSON.parse(fromSession) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser)

  const login = (userData, remember = true) => {
    setUser(userData)
    const serialized = JSON.stringify(userData)
    if (remember) {
      localStorage.setItem(STORAGE_KEY, serialized)
      sessionStorage.removeItem(STORAGE_KEY)
    } else {
      sessionStorage.setItem(STORAGE_KEY, serialized)
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
