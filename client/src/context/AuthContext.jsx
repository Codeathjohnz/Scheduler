import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

export const ROLES = {
  CHAIR:             'chair',
  DEAN:              'dean',
  QUALITY_ASSURANCE: 'quality_assurance',
  VPAA:              'vpaa',
  ADMIN:             'admin',
  INSTRUCTOR:        'instructor',
  STUDENT:           'student',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('adssu_user')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  const login = (userData) => {
    setUser(userData)
    localStorage.setItem('adssu_user', JSON.stringify(userData))
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('adssu_user')
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
