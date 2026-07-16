import { useState, useEffect, useCallback } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { usersAPI, prospectusAPI } from '../../services/api.js'
import toast from 'react-hot-toast'
import {
  Plus, Pencil, Trash2, X, Eye, EyeOff,
  Users, ShieldCheck, GraduationCap, BookOpen, UserCircle, Loader2, Search,
  Mail, Building2, Star, IdCard, Award, BadgeCheck, Bookmark
} from 'lucide-react'

const ROLES = [
  { value: 'admin',      label: 'Admin / Registrar',  icon: ShieldCheck,    color: 'bg-red-100 text-red-700' },
  { value: 'chair',      label: 'Program Chair',       icon: GraduationCap,  color: 'bg-blue-100 text-blue-700' },
  { value: 'dean',       label: 'Dean',                icon: Award,          color: 'bg-indigo-100 text-indigo-700' },
  { value: 'chief_cpd',  label: 'Chief Curriculum Planning and Development', icon: Bookmark, color: 'bg-cyan-100 text-cyan-700' },
  { value: 'quality_assurance', label: 'Quality Assurance', icon: BadgeCheck, color: 'bg-teal-100 text-teal-700' },
  { value: 'vpaa',       label: 'VPAA',                icon: UserCircle,     color: 'bg-purple-100 text-purple-700' },
  { value: 'instructor', label: 'Instructor',           icon: BookOpen,       color: 'bg-amber-100 text-amber-700' },
  { value: 'student',    label: 'Student',              icon: Users,          color: 'bg-green-100 text-green-700' },
]

const ROLE_MAP = Object.fromEntries(ROLES.map(r => [r.value, r]))

const EMPTY_FORM = { username: '', password: '', name: '', role: 'instructor', department: '', section: '', email: '' }

/* ── Instructor Detail Modal ─────────────────────────────────────────────── */
function InstructorDetailModal({ user, onClose }) {
  const [specialties, setSpecialties] = useState([])
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    prospectusAPI.getInstructorSpecialties(user.id)
      .then(r => setSpecialties(r.data))
      .catch(() => setSpecialties([]))
      .finally(() => setLoading(false))
  }, [user.id])

  // Group specialties by year level
  const byYear = specialties.reduce((acc, s) => {
    const key = s.year_level ? `Year ${s.year_level}` : 'General'
    ;(acc[key] = acc[key] || []).push(s)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-green-800 rounded-t-2xl shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center">
              <span className="text-green-900 font-bold text-sm">{user.name.charAt(0)}</span>
            </div>
            <div>
              <p className="text-white font-bold">{user.name}</p>
              <p className="text-green-300 text-xs">Instructor Profile</p>
            </div>
          </div>
          <button onClick={onClose} className="text-green-300 hover:text-white"><X className="w-5 h-5"/></button>
        </div>

        {/* Info strip */}
        <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 px-4 py-3">
            <IdCard className="w-4 h-4 text-gray-400 shrink-0"/>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase">Username</p>
              <p className="text-xs font-semibold text-gray-700 font-mono">{user.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-3">
            <Building2 className="w-4 h-4 text-gray-400 shrink-0"/>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase">Department</p>
              <p className="text-xs font-semibold text-gray-700">{user.department || '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-3">
            <Mail className="w-4 h-4 text-gray-400 shrink-0"/>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase">Email</p>
              <p className="text-xs font-semibold text-gray-700 truncate max-w-[120px]">{user.email || '—'}</p>
            </div>
          </div>
        </div>

        {/* Specialties */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Star className="w-4 h-4 text-amber-500"/>
            <span className="text-sm font-bold text-gray-700">Subject Specialties</span>
            {!loading && (
              <span className="ml-auto text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                {specialties.length} subject{specialties.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin"/> Loading specialties…
            </div>
          ) : specialties.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30"/>
              <p className="text-sm">No specialties selected yet.</p>
              <p className="text-xs mt-1">The instructor can set these in <strong>My Specialty</strong>.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(byYear).map(([year, subjects]) => (
                <div key={year}>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">{year}</p>
                  <div className="space-y-1.5">
                    {subjects.map(s => (
                      <div key={s.id} className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                        <span className="shrink-0 font-mono text-xs font-bold text-amber-700 pt-0.5 min-w-[90px]">{s.course_code}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-700 leading-snug">{s.descriptive_title}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {s.units} unit{s.units !== 1 ? 's' : ''}
                            {s.lec_hours > 0 && ` · ${s.lec_hours}h lec`}
                            {s.lab_hours > 0 && ` · ${s.lab_hours}h lab`}
                            {s.semester && ` · Sem ${s.semester}`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UserManagement() {
  const [users, setUsers]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [search, setSearch]       = useState('')
  const [filterRole, setFilterRole] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser]   = useState(null)   // null = create mode
  const [form, setForm]           = useState(EMPTY_FORM)
  const [showPw, setShowPw]       = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [viewUser, setViewUser]         = useState(null)    // instructor detail panel

  const fetchUsers = useCallback(async () => {
    try {
      const res = await usersAPI.getAll()
      setUsers(res.data)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load users.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const openCreate = () => {
    setEditUser(null)
    setForm(EMPTY_FORM)
    setShowPw(false)
    setShowModal(true)
  }

  const openEdit = (user) => {
    setEditUser(user)
    setForm({
      username:   user.username,
      password:   '',
      name:       user.name,
      role:       user.role,
      department: user.department || '',
      section:    user.section    || '',
      email:      user.email      || '',
    })
    setShowPw(false)
    setShowModal(true)
  }

  const closeModal = () => { setShowModal(false); setEditUser(null) }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.username || !form.name || !form.role) {
      toast.error('Username, name, and role are required.')
      return
    }
    if (!editUser && !form.password) {
      toast.error('Password is required for new users.')
      return
    }
    setSaving(true)
    try {
      if (editUser) {
        const payload = { name: form.name, role: form.role, department: form.department, section: form.section, email: form.email }
        if (form.password) payload.password = form.password
        await usersAPI.update(editUser.id, payload)
        toast.success('User updated successfully.')
      } else {
        await usersAPI.create(form)
        toast.success('User created successfully.')
      }
      closeModal()
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save user.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await usersAPI.remove(deleteTarget.id)
      toast.success(`${deleteTarget.name} deleted.`)
      setDeleteTarget(null)
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete user.')
    }
  }

  const filtered = users.filter(u => {
    const matchRole   = filterRole === 'all' || u.role === filterRole
    const matchSearch = search === '' ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      (u.department || '').toLowerCase().includes(search.toLowerCase())
    return matchRole && matchSearch
  })

  const needsSection = form.role === 'student'

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Create and manage system users across all roles."
        action={
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white font-semibold px-4 py-2.5 rounded-xl transition shadow text-sm">
            <Plus className="w-4 h-4" /> Add User
          </button>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {ROLES.map(r => {
          const count = users.filter(u => u.role === r.value).length
          return (
            <button key={r.value}
              onClick={() => setFilterRole(f => f === r.value ? 'all' : r.value)}
              className={`rounded-xl border p-3 text-left transition ${filterRole === r.value ? 'ring-2 ring-green-500' : ''} ${r.color}`}>
              <p className="text-xl font-bold">{count}</p>
              <p className="text-xs font-medium opacity-80">{r.label}</p>
            </button>
          )
        })}
      </div>

      {/* Search & filter */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, username, or department..."
            className="w-full border-2 border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-green-500 transition"
          />
        </div>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 transition bg-white">
          <option value="all">All Roles</option>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* Users table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading users...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Users className="w-10 h-10 mb-3 opacity-40" />
            <p className="font-medium">No users found.</p>
            <p className="text-sm mt-1">Try adjusting your search or filter.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">#</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Username</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Department / Section</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Created</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((u, i) => {
                const role = ROLE_MAP[u.role]
                const RoleIcon = role?.icon
                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-green-700 flex items-center justify-center shrink-0">
                          <span className="text-white font-bold text-xs">{u.name.charAt(0)}</span>
                        </div>
                        <span className="font-semibold text-gray-800">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-500 font-mono text-xs">{u.username}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${role?.color}`}>
                        {RoleIcon && <RoleIcon className="w-3 h-3" />}
                        {role?.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {u.department || '—'}
                      {u.section && <span className="ml-1 text-green-600 font-medium">· {u.section}</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {u.role === 'instructor' && (
                          <button onClick={() => setViewUser(u)}
                            title="View specialties"
                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition">
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => openEdit(u)}
                          className="p-1.5 text-gray-400 hover:text-green-700 hover:bg-green-50 rounded-lg transition">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteTarget(u)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create / Edit Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-green-800 rounded-t-2xl">
              <div>
                <p className="text-white font-bold">{editUser ? 'Edit User' : 'Create New User'}</p>
                <p className="text-green-300 text-xs mt-0.5">{editUser ? `Editing: ${editUser.username}` : 'Fill in the details below'}</p>
              </div>
              <button onClick={closeModal} className="text-green-300 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name <span className="text-red-500">*</span></label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Juan Dela Cruz"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-green-500 transition"
                />
              </div>

              {/* Username */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Username <span className="text-red-500">*</span></label>
                <input
                  required
                  value={form.username}
                  disabled={!!editUser}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="e.g. jdelacruz"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-green-500 transition disabled:bg-gray-50 disabled:text-gray-400"
                />
                {editUser && <p className="text-xs text-gray-400 mt-1">Username cannot be changed.</p>}
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Password {!editUser && <span className="text-red-500">*</span>}
                  {editUser && <span className="text-gray-400 font-normal"> (leave blank to keep current)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder={editUser ? 'Leave blank to keep current password' : 'Enter password'}
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:border-green-500 transition"
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Role <span className="text-red-500">*</span></label>
                <select required value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, section: '' }))}
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-green-500 transition bg-white">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Department / Office</label>
                <input
                  list="dept-list"
                  value={form.department}
                  onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  placeholder="Select or type a department…"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-green-500 transition"
                />
                <datalist id="dept-list">
                  <option value="CCIS" />
                  <option value="General Education" />
                  <option value="PATHFIT" />
                  <option value="NSTP" />
                  <option value="CEIT" />
                  <option value="CON" />
                  <option value="CBPA" />
                  <option value="CTE" />
                  <option value="Office of the VPAA" />
                  <option value="Registrar's Office" />
                </datalist>
              </div>

              {/* Section — only for students */}
              {needsSection && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Section <span className="text-red-500">*</span></label>
                  <input
                    required
                    value={form.section}
                    onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
                    placeholder="e.g. BSIS 1A"
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-green-500 transition"
                  />
                </div>
              )}

              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Email Address
                  <span className="text-gray-400 font-normal"> (required for Change Password)</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="e.g. juan.delacruz@email.com"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-green-500 transition"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : (editUser ? 'Save Changes' : 'Create User')}
                </button>
                <button type="button" onClick={closeModal}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Instructor Detail Modal ── */}
      {viewUser && (
        <InstructorDetailModal user={viewUser} onClose={() => setViewUser(null)} />
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-center font-bold text-gray-800 mb-1">Delete User</h3>
            <p className="text-center text-sm text-gray-500 mb-6">
              Are you sure you want to delete <span className="font-semibold text-gray-700">{deleteTarget.name}</span>?
              This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={handleDelete}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl transition text-sm">
                Yes, Delete
              </button>
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
