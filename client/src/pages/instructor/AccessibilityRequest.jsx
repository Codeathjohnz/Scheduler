import { useState, useEffect } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { Send, Accessibility, Loader2, Clock } from 'lucide-react'
import { accessibilityAPI } from '../../services/api.js'

const REASONS = [
  'I have mobility limitations.',
  'I require accessibility-based room assignment.',
  'I have temporary or permanent health conditions affecting mobility.',
]

const STATUS_STYLE = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
}

const LEVEL_LABEL = {
  1: 'Level 1 – Ground floor only (wheelchair)',
  2: 'Level 2 – Prefer lower floors',
  3: 'Level 3 – No restriction',
}

export default function InstructorAccessibilityRequest() {
  const [form, setForm]         = useState({ reason: '', details: '' })
  const [submitting, setSubmitting] = useState(false)
  const [existing, setExisting] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState(true)

  useEffect(() => {
    accessibilityAPI.getMy()
      .then(res => setExisting(res.data || null))
      .catch(() => setExisting(null))
      .finally(() => setLoadingStatus(false))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.reason) { toast.error('Please select a reason.'); return }
    setSubmitting(true)
    try {
      await accessibilityAPI.submit({ reason: form.reason, details: form.details })
      toast.success('Accessibility request submitted for Admin review.')
      setExisting({ status: 'pending', reason: form.reason })
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
      </div>
    )
  }

  if (existing) {
    return (
      <div>
        <PageHeader title="Accessibility Request" />
        <div className={`rounded-2xl border p-8 text-center max-w-md mx-auto mt-8 ${STATUS_STYLE[existing.status] || 'bg-gray-50'}`}>
          <div className="w-14 h-14 bg-white/60 rounded-full flex items-center justify-center mx-auto mb-4">
            {existing.status === 'pending'
              ? <Clock className="w-7 h-7 opacity-70" />
              : <Accessibility className="w-7 h-7 opacity-70" />
            }
          </div>
          <h2 className="text-lg font-bold mb-2">
            {existing.status === 'pending'  && 'Request Pending Review'}
            {existing.status === 'approved' && 'Request Approved'}
            {existing.status === 'rejected' && 'Request Rejected'}
          </h2>
          {existing.status === 'pending' && (
            <p className="text-sm">Your request is being reviewed by the Admin/Registrar. You will be notified once it's processed.</p>
          )}
          {existing.status === 'approved' && existing.mobility_level && (
            <p className="text-sm">{LEVEL_LABEL[existing.mobility_level]} — the AI scheduler will apply this preference to your room assignments.</p>
          )}
          {existing.status === 'rejected' && (
            <p className="text-sm">Your request was not approved. You may submit a new one below.</p>
          )}
          {existing.status === 'rejected' && (
            <button onClick={() => setExisting(null)} className="mt-4 text-sm underline opacity-70">Submit a new request</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Accessibility Request" subtitle="Submit a room accessibility request for mobility or health-related needs." />

      <div className="max-w-xl">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-700">
          Your request will be reviewed by the Admin/Registrar, who will assign a mobility level
          (Level 1–3) to ensure appropriate room assignments from the AI scheduler.
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Select your reason <span className="text-red-500">*</span></label>
            <div className="space-y-2">
              {REASONS.map(r => (
                <label key={r} className="flex items-start gap-3 cursor-pointer">
                  <input type="radio" name="reason" value={r} checked={form.reason === r}
                    onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                    className="mt-0.5 accent-orange-500" />
                  <span className="text-sm text-gray-700">{r}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Additional details (optional)</label>
            <textarea value={form.details} onChange={e => setForm(f => ({ ...f, details: e.target.value }))} rows={3}
              placeholder="Describe your condition or any specific needs..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none" />
          </div>

          <button type="submit" disabled={submitting}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-lg transition">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  )
}
