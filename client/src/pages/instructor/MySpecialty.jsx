import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { prospectusAPI, usersAPI } from '../../services/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import ProgramPicker from '../../components/common/ProgramPicker.jsx'
import {
  BookOpen, CheckCircle2, Loader2, ChevronDown, ChevronUp,
  GraduationCap, Save, FlaskConical, School, Users
} from 'lucide-react'

const SEM_LABEL = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' }
const YEAR_LABEL = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' }
const YEAR_COLORS = {
  1: { header: 'bg-blue-700', light: 'bg-blue-50 border-blue-200', badge: 'bg-blue-100 text-blue-800' },
  2: { header: 'bg-green-700', light: 'bg-green-50 border-green-200', badge: 'bg-green-100 text-green-800' },
  3: { header: 'bg-amber-600', light: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-800' },
  4: { header: 'bg-purple-700', light: 'bg-purple-50 border-purple-200', badge: 'bg-purple-100 text-purple-800' },
}

function groupSubjects(subjects) {
  const groups = {}
  for (const s of subjects) {
    const key = `${s.year_level}-${s.semester}`
    if (!groups[key]) groups[key] = { year_level: s.year_level, semester: s.semester, subjects: [] }
    groups[key].subjects.push(s)
  }
  return Object.values(groups).sort((a, b) =>
    a.year_level !== b.year_level ? a.year_level - b.year_level : a.semester - b.semester
  )
}

// Which program(s) this person teaches for within their department — e.g. a
// CCIS instructor can teach for BSIT, BSIS, or both. Auto-generate only offers
// them the subjects of programs they've picked here (none picked = all).
function MyPrograms() {
  const { user } = useAuth()
  const [programs, setPrograms] = useState([])
  const [options, setOptions]   = useState([])
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)

  useEffect(() => {
    Promise.all([usersAPI.getOne(user.id), usersAPI.getProgramOptions(user.department)])
      .then(([me, opts]) => {
        setPrograms(String(me.data.programs || '').split(',').map(p => p.trim()).filter(Boolean))
        setOptions(opts.data)
      })
      .catch(() => {})
  }, [user.id, user.department])

  const save = async () => {
    setSaving(true)
    try {
      await usersAPI.setMyPrograms(programs)
      toast.success('Programs saved.')
      setDirty(false)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save programs.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mb-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="font-bold text-gray-800 text-sm">I teach for these programs</h3>
          <p className="text-xs text-gray-500 mt-0.5">Pick BSIT, BSIS, or both — you'll only be assigned subjects from the programs you select.</p>
        </div>
        <button onClick={save} disabled={saving || !dirty}
          className="shrink-0 flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-xl transition text-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Programs
        </button>
      </div>
      <ProgramPicker value={programs} options={options} onChange={p => { setPrograms(p); setDirty(true) }} />
    </div>
  )
}

// Whether chairs from OTHER departments may ask this person to teach one of
// their subjects (e.g. an IT instructor helping Agriculture's digital-innovation
// course). Off by default. Turning it on only makes them askable — every request
// still needs their own accept and their home department's approval.
function OpenToOtherDepartments() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    usersAPI.getOne(user.id).then(r => setOpen(!!r.data.cross_dept_open)).catch(() => {}).finally(() => setReady(true))
  }, [user.id])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    try {
      await usersAPI.setMyCrossDept(next)
      toast.success(next ? 'Other departments can now ask you to teach.' : 'Other departments can no longer ask you.')
    } catch (err) {
      setOpen(!next)
      toast.error(err.response?.data?.message || 'Failed to save.')
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mb-5">
      <label className={`flex items-start gap-3 ${ready ? 'cursor-pointer' : 'opacity-60'}`}>
        <input type="checkbox" checked={open} disabled={!ready} onChange={toggle} className="accent-green-700 w-4 h-4 mt-1 shrink-0" />
        <div>
          <p className="font-bold text-gray-800 text-sm">I'm open to teaching for other departments</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Chairs from other colleges (e.g. Agriculture needing help with digital innovation) will be able to <em>ask</em> you to teach a subject that matches your specialties.
            Nothing is assigned on its own: you can accept or decline each request, and your own department's chair or dean has to approve it before it's added to your load.
          </p>
        </div>
      </label>
    </div>
  )
}

export default function MySpecialty() {
  const [subjects, setSubjects]   = useState([])
  const [groups, setGroups]       = useState([])
  // subject id → priority (1 = first choice, 2 = second choice); presence = selected
  const [selected, setSelected]   = useState(new Map())
  const [peers, setPeers]         = useState({})
  const [expanded, setExpanded]   = useState({})
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [semFilter, setSemFilter] = useState('all')

  useEffect(() => {
    const load = async () => {
      try {
        const [subRes, selRes, peersRes] = await Promise.all([
          prospectusAPI.getLatestSubjects(),
          prospectusAPI.getMySpecialties(),
          prospectusAPI.getSpecialtyPeers(),
        ])
        setSubjects(subRes.data)
        const g = groupSubjects(subRes.data)
        setGroups(g)
        const exp = {}
        g.forEach(grp => { exp[`${grp.year_level}-${grp.semester}`] = true })
        setExpanded(exp)
        setSelected(new Map(selRes.data.map(sp => [sp.subject_id, sp.priority === 2 ? 2 : 1])))
        setPeers(peersRes.data)
      } catch {
        toast.error('Failed to load subjects.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Map(prev)
      next.has(id) ? next.delete(id) : next.set(id, 1)   // newly picked subjects start as 1st priority
      return next
    })
  }

  const setPriority = (id, priority) => {
    setSelected(prev => new Map(prev).set(id, priority))
  }

  const toggleAll = (groupSubjects, checked) => {
    setSelected(prev => {
      const next = new Map(prev)
      groupSubjects.forEach(s => checked ? (next.has(s.id) || next.set(s.id, 1)) : next.delete(s.id))
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await prospectusAPI.saveMySpecialties([...selected].map(([subject_id, priority]) => ({ subject_id, priority })))
      toast.success(`Saved ${selected.size} subject specialt${selected.size === 1 ? 'y' : 'ies'} successfully.`)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const toggleExpand = (key) => setExpanded(e => ({ ...e, [key]: !e[key] }))

  const availableSemesters = [...new Set(subjects.map(s => s.semester))].sort((a, b) => a - b)
  const visibleSubjects = semFilter === 'all' ? subjects : subjects.filter(s => s.semester === semFilter)
  const visibleGroups   = semFilter === 'all' ? groups : groups.filter(g => g.semester === semFilter)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading curriculum...
      </div>
    )
  }

  if (subjects.length === 0) {
    return (
      <div>
        <PageHeader title="My Teaching Specialty" subtitle="Select the subjects you are qualified to teach." />
        <MyPrograms />
        <OpenToOtherDepartments />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center py-20 text-gray-400">
          <BookOpen className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-semibold text-gray-500">No prospectus has been uploaded yet.</p>
          <p className="text-sm mt-1">Please ask your Program Chair to upload the curriculum prospectus first.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="My Teaching Specialty"
        subtitle="Select the subjects you can teach and mark each as 1st or 2nd priority. Your 1st-priority subjects are assigned to you first (all their sections); 2nd-priority subjects only fill in if you still have room in your load."
        action={
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-xl transition shadow text-sm">
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              : <><Save className="w-4 h-4" /> Save Specialties</>}
          </button>
        }
      />

      <MyPrograms />
      <OpenToOtherDepartments />

      {/* Semester filter */}
      {availableSemesters.length > 1 && (
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-2xl p-1 w-fit">
          {[['all', 'All Semesters'], ...availableSemesters.map(sem => [sem, SEM_LABEL[sem] || `Semester ${sem}`])].map(([val, label]) => (
            <button key={val} onClick={() => setSemFilter(val)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${semFilter===val?'bg-white text-green-800 shadow':'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Summary bar */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-bold text-lg">{visibleSubjects.filter(s => selected.has(s.id)).length}</span>
          <span className="text-sm text-gray-500">
            of {visibleSubjects.length} subjects selected as my specialty
            {semFilter !== 'all' && ` (${SEM_LABEL[semFilter] || semFilter})`}
            {selected.size > 0 && semFilter !== 'all' && ` — ${selected.size} total across all semesters`}
            {selected.size > 0 && ` · ${[...selected.values()].filter(p => p === 1).length} first priority, ${[...selected.values()].filter(p => p === 2).length} second priority`}
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setSelected(prev => { const next = new Map(prev); visibleSubjects.forEach(s => next.has(s.id) || next.set(s.id, 1)); return next })}
            className="text-xs bg-green-100 hover:bg-green-200 text-green-800 font-semibold px-3 py-1.5 rounded-lg transition">
            Select All
          </button>
          <button onClick={() => setSelected(prev => {
            const next = new Map(prev)
            visibleSubjects.forEach(s => next.delete(s.id))
            return next
          })}
            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold px-3 py-1.5 rounded-lg transition">
            Clear All
          </button>
        </div>
      </div>

      {/* Subject groups */}
      <div className="space-y-4">
        {visibleGroups.map(g => {
          const key = `${g.year_level}-${g.semester}`
          const open = expanded[key]
          const colors = YEAR_COLORS[g.year_level] || YEAR_COLORS[1]
          const groupSelected = g.subjects.filter(s => selected.has(s.id)).length
          const allGroupSelected = groupSelected === g.subjects.length

          return (
            <div key={key} className={`rounded-2xl border-2 overflow-hidden shadow-sm ${colors.light}`}>
              {/* Group header */}
              <div className={`${colors.header} px-5 py-3 flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <GraduationCap className="w-4 h-4 text-white opacity-80" />
                  <span className="text-white font-bold text-sm">
                    {YEAR_LABEL[g.year_level]} — {SEM_LABEL[g.semester]}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors.badge}`}>
                    {groupSelected}/{g.subjects.length} selected
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-white text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allGroupSelected}
                      onChange={e => toggleAll(g.subjects, e.target.checked)}
                      className="accent-amber-400 w-4 h-4"
                    />
                    Select all
                  </label>
                  <button onClick={() => toggleExpand(key)} className="text-white opacity-80 hover:opacity-100">
                    {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Subjects grid */}
              {open && (
                <div className="p-4 grid gap-2">
                  {g.subjects.map(s => {
                    const isSelected = selected.has(s.id)
                    const subjectPeers = peers[s.id] || []
                    return (
                      <label key={s.id}
                        className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${
                          isSelected
                            ? 'border-green-500 bg-green-50 shadow-sm'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(s.id)}
                          className="accent-green-700 w-4 h-4 mt-0.5 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-sm text-green-800">{s.course_code}</span>
                            {s.lab_hours > 0 && (
                              <span className="flex items-center gap-1 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                                <FlaskConical className="w-3 h-3" /> Lab
                              </span>
                            )}
                            {s.lab_hours === 0 && (
                              <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                <School className="w-3 h-3" /> Lecture
                              </span>
                            )}
                            {subjectPeers.length > 0 && (
                              <span
                                title={`Also chosen by: ${subjectPeers.map(p => p.name).join(', ')}`}
                                className="flex items-center gap-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                                <Users className="w-3 h-3" />
                                {subjectPeers.length} colleague{subjectPeers.length !== 1 ? 's' : ''} also teach{subjectPeers.length === 1 ? 'es' : ''} this
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-700 mt-0.5">{s.descriptive_title}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {s.units} unit{s.units !== 1 ? 's' : ''} · {s.lec_hours}h Lec{s.lab_hours > 0 ? ` · ${s.lab_hours}h Lab` : ''}
                            {s.prerequisite && <span className="ml-2 text-amber-600">Pre-req: {s.prerequisite}</span>}
                          </p>
                        </div>
                        {isSelected && (
                          <div className="flex rounded-lg overflow-hidden border border-green-300 shrink-0 self-center text-xs font-bold" title="1st priority subjects are assigned to you first; 2nd priority only fill in while you still have room in your load">
                            {[1, 2].map(p => (
                              <button key={p} type="button"
                                onClick={e => { e.preventDefault(); e.stopPropagation(); setPriority(s.id, p) }}
                                className={`px-2.5 py-1 transition ${selected.get(s.id) === p
                                  ? (p === 1 ? 'bg-green-700 text-white' : 'bg-amber-500 text-white')
                                  : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                                {p === 1 ? '1st' : '2nd'}
                              </button>
                            ))}
                          </div>
                        )}
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Floating save */}
      <div className="sticky bottom-4 mt-6 flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold px-6 py-3 rounded-2xl shadow-xl transition text-sm">
          {saving
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
            : <><Save className="w-4 h-4" /> Save {selected.size} Specialt{selected.size === 1 ? 'y' : 'ies'}</>}
        </button>
      </div>
    </div>
  )
}
