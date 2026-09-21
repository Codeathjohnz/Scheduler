import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Bell, Check, X, ArrowUpRight, Loader2, CheckCheck } from 'lucide-react'
import { notificationsAPI, placeholdersAPI } from '../../services/api.js'

// How long ago, in plain words.
function ago(ts) {
  const s = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
  return `${Math.floor(s / 86400)} day${Math.floor(s / 86400) > 1 ? 's' : ''} ago`
}

const FLAG = {
  exception: { chip: 'Exception', cls: 'bg-amber-100 text-amber-800', bar: 'border-amber-400' },
  attention: { chip: 'Needs attention', cls: 'bg-red-100 text-red-800', bar: 'border-red-400' },
}

/**
 * The dashboard notification box — shown on every role's dashboard. Loads the
 * signed-in user's own notifications, refreshes every minute, and lets them
 * mark items read. A "you've been assigned a load" item carries Confirm/Decline
 * buttons for as long as it's still waiting on their answer.
 */
export default function NotificationBox() {
  const navigate = useNavigate()
  const [items, setItems]   = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]     = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await notificationsAPI.list()
      setItems(r.data.items); setUnread(r.data.unread)
    } catch { /* the box just stays as it was */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  const open = async (n) => {
    if (!n.read_at) {
      await notificationsAPI.read(n.id).catch(() => {})
      setItems(list => list.map(i => i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i))
      setUnread(u => Math.max(0, u - 1))
    }
  }

  const markAll = async () => {
    await notificationsAPI.readAll().catch(() => {})
    setItems(list => list.map(i => ({ ...i, read_at: i.read_at || new Date().toISOString() })))
    setUnread(0)
  }

  const respond = async (n, action) => {
    setBusy(n.id)
    try {
      const r = await placeholdersAPI.respond(n.ref_id, action)
      toast.success(r.data.message)
      await open(n)
      await load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-green-700" />
          <h3 className="font-bold text-gray-800 text-sm">Notifications</h3>
          {unread > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unread} new</span>}
        </div>
        {unread > 0 && (
          <button onClick={markAll} className="flex items-center gap-1 text-xs font-semibold text-green-700 hover:text-green-800">
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : items.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-gray-400">You're all caught up — nothing new.</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-gray-100">
          {items.map(n => {
            const flag = FLAG[n.flag]
            const needsAnswer = n.type === 'load_assigned' && n.action_status === 'pending'
            return (
              <li key={n.id} onClick={() => open(n)}
                className={`px-5 py-3 border-l-4 cursor-pointer transition ${flag ? flag.bar : n.read_at ? 'border-transparent' : 'border-green-500'} ${n.read_at ? 'bg-white' : 'bg-green-50/50 hover:bg-green-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm leading-snug ${n.read_at ? 'text-gray-700' : 'text-gray-900 font-semibold'}`}>
                      {n.title}
                      {flag && <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full align-middle ${flag.cls}`}>{flag.chip}</span>}
                    </p>
                    {n.body && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>}
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0 whitespace-nowrap">{ago(n.created_at)}</span>
                </div>

                {needsAnswer && (
                  <div className="flex gap-2 mt-2" onClick={e => e.stopPropagation()}>
                    <button disabled={busy === n.id} onClick={() => respond(n, 'confirm')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg">
                      {busy === n.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirm my load
                    </button>
                    <button disabled={busy === n.id} onClick={() => respond(n, 'decline')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-lg">
                      <X className="w-3.5 h-3.5" /> Decline
                    </button>
                  </div>
                )}
                {n.type === 'load_assigned' && n.action_status && n.action_status !== 'pending' && (
                  <p className="text-[11px] mt-1 font-semibold text-gray-500">{n.action_status === 'confirmed' ? '✓ You confirmed this' : 'You declined this'}</p>
                )}
                {n.link && !needsAnswer && (
                  <button onClick={e => { e.stopPropagation(); open(n); navigate(n.link) }}
                    className="flex items-center gap-1 mt-1.5 text-xs font-semibold text-green-700 hover:text-green-800">
                    Open <ArrowUpRight className="w-3 h-3" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
