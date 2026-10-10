import { useState } from 'react'
import { Loader2, XCircle } from 'lucide-react'

/**
 * "Return for Revision" with a required reason. Collapsed to a single button;
 * clicking it opens a reason box, and the actual return only fires once
 * something is typed — the chair gets this reason verbatim in their notification.
 */
export default function ReturnReasonButton({ busy, onReturn, label = 'Return for Revision' }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        className="flex items-center gap-2 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
      >
        <XCircle className="w-4 h-4" />
        {label}
      </button>
    )
  }

  return (
    <div className="flex flex-wrap gap-2 items-center w-full">
      <input
        autoFocus
        value={reason}
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && reason.trim()) onReturn(reason.trim()) }}
        maxLength={255}
        placeholder="Reason for returning this submission (required — the chair will see this)"
        className="flex-1 min-w-[260px] border-2 border-red-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400"
      />
      <button
        disabled={busy || !reason.trim()}
        onClick={() => onReturn(reason.trim())}
        className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
        Confirm Return
      </button>
      <button onClick={() => { setOpen(false); setReason('') }} className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700">
        Cancel
      </button>
    </div>
  )
}
