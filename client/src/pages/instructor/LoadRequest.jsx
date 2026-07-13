import { useState, useEffect } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { Send, Loader2, Briefcase, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { loadRequestAPI } from '../../services/api.js'

const LOAD_TYPES = [
  { key: 'administrative', label: 'Administrative Load' },
  { key: 'research',       label: 'Research Load' },
  { key: 'extension',      label: 'Extension Load' },
  { key: 'project',        label: 'Project Load' },
]
const HOURS_TYPES = [
  { key: 'consultation', label: 'Consultation' },
  { key: 'lesson_prep',  label: 'Lesson Preparation' },
]
const LOAD_TYPE_LABEL = Object.fromEntries([...LOAD_TYPES, ...HOURS_TYPES].map(t => [t.key, t.label]))
const HOURS_ONLY_TYPES = new Set(HOURS_TYPES.map(t => t.key))

const STATUS_STYLE = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
}
const STATUS_ICON = { pending: Clock, approved: CheckCircle2, rejected: XCircle }

const EMPTY_FORM = { academic_year: '2026-2027', semester: 1, load_type: 'administrative', description: '', units: '' }
const EMPTY_HOURS_FORM = { academic_year: '2026-2027', semester: 1, consultation: '', lesson_prep: '' }

export default function InstructorLoadRequest() {
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [hoursForm, setHoursForm] = useState(EMPTY_HOURS_FORM)
  const [submittingHours, setSubmittingHours] = useState(false)
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchRequests = () => {
    setLoading(true)
    loadRequestAPI.getMy()
      .then(r => setRequests(r.data))
      .catch(() => toast.error('Failed to load your requests.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchRequests() }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.description.trim()) { toast.error('Title is required.'); return }
    if (!form.units || Number(form.units) <= 0) { toast.error('Unit credit is required.'); return }
    setSubmitting(true)
    try {
      await loadRequestAPI.submit({ ...form, units: Number(form.units), hours: null })
      toast.success('Load request submitted for your Program Chair to review.')
      setForm(EMPTY_FORM)
      fetchRequests()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  // Consultation and Lesson Preparation are independent hour inputs — either,
  // both, or neither can be filled in and submitted together as separate requests.
  const handleSubmitHours = async (e) => {
    e.preventDefault()
    const jobs = HOURS_TYPES
      .filter(t => hoursForm[t.key] && Number(hoursForm[t.key]) > 0)
      .map(t => ({ load_type: t.key, hours: Number(hoursForm[t.key]) }))
    if (jobs.length === 0) {
      toast.error('Enter at least one of Consultation or Lesson Preparation hours.')
      return
    }
    setSubmittingHours(true)
    try {
      for (const job of jobs) {
        await loadRequestAPI.submit({
          academic_year: hoursForm.academic_year, semester: hoursForm.semester,
          load_type: job.load_type, units: 0, hours: job.hours,
        })
      }
      toast.success(`Submitted ${jobs.length} hour request${jobs.length > 1 ? 's' : ''} for your Program Chair to review.`)
      setHoursForm(EMPTY_HOURS_FORM)
      fetchRequests()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit hours.')
    } finally {
      setSubmittingHours(false)
    }
  }

  return (
    <div>
      <PageHeader title="Load Request" subtitle="Submit administrative, research, extension, project, consultation, or lesson preparation load for your Program Chair to review." />

      <div className="max-w-2xl">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-700">
          Your request will be reviewed by your Program Chair. Once approved, it's added to your
          faculty loading sheet. Administrative/Research/Extension/Project load counts toward your
          total unit credit — Consultation and Lesson Preparation are logged as hours only and don't.
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 mb-8">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
              <input value={form.academic_year} onChange={e=>setForm(f=>({...f,academic_year:e.target.value}))}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
              <select value={form.semester} onChange={e=>setForm(f=>({...f,semester:Number(e.target.value)}))}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white">
                <option value={1}>1st Semester</option>
                <option value={2}>2nd Semester</option>
                <option value={3}>Summer</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Load Type</label>
            <select value={form.load_type} onChange={e=>setForm(f=>({...f,load_type:e.target.value}))}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white">
              {LOAD_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Title <span className="text-red-500">*</span></label>
            <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
              placeholder="e.g. Program Chairperson, BSIT"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Unit Credit <span className="text-red-500">*</span></label>
            <input type="number" min="0" step="0.5" value={form.units} onChange={e=>setForm(f=>({...f,units:e.target.value}))}
              placeholder="e.g. 3"
              className="w-full max-w-[160px] border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
          </div>

          <button type="submit" disabled={submitting}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-lg transition">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>

        {/* Consultation & Lesson Preparation — separate hours-only inputs, no
            title or unit credit, can be filled in independently or together. */}
        <form onSubmit={handleSubmitHours} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 mb-8">
          <div>
            <h3 className="text-sm font-bold text-gray-800">Consultation &amp; Lesson Preparation</h3>
            <p className="text-xs text-gray-400 mt-0.5">Hours only — no title or unit credit needed. Fill in either or both.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
              <input value={hoursForm.academic_year} onChange={e=>setHoursForm(f=>({...f,academic_year:e.target.value}))}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
              <select value={hoursForm.semester} onChange={e=>setHoursForm(f=>({...f,semester:Number(e.target.value)}))}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white">
                <option value={1}>1st Semester</option>
                <option value={2}>2nd Semester</option>
                <option value={3}>Summer</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {HOURS_TYPES.map(t => (
              <div key={t.key}>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.label} (hrs/week)</label>
                <input type="number" min="0" step="0.5" value={hoursForm[t.key]}
                  onChange={e=>setHoursForm(f=>({...f,[t.key]:e.target.value}))}
                  placeholder="e.g. 3"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
              </div>
            ))}
          </div>

          <button type="submit" disabled={submittingHours}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-lg transition">
            {submittingHours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {submittingHours ? 'Submitting...' : 'Submit Hours'}
          </button>
        </form>

        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Your Requests</h2>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl flex flex-col items-center justify-center py-12 text-gray-400">
            <Briefcase className="w-10 h-10 mb-3 opacity-30" />
            <p className="font-medium text-gray-500">No load requests yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map(r => {
              const Icon = STATUS_ICON[r.status]
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">
                      {HOURS_ONLY_TYPES.has(r.load_type)
                        ? LOAD_TYPE_LABEL[r.load_type]
                        : <>{LOAD_TYPE_LABEL[r.load_type]}: <span className="font-normal text-gray-600">{r.description}</span></>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      AY {r.academic_year}, {['','1st','2nd','Summer'][r.semester]} Semester ·{' '}
                      {HOURS_ONLY_TYPES.has(r.load_type) ? `${r.hours} hours/week` : `${r.units} units`} ·{' '}
                      Submitted {new Date(r.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[r.status]}`}>
                    <Icon className="w-3.5 h-3.5" /> {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
