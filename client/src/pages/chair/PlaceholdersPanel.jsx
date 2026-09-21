import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { placeholdersAPI } from '../../services/api.js'
import { Loader2, UserCheck, Sparkles, X, AlertTriangle, CheckCircle2, Clock, ArrowRight } from 'lucide-react'

const TARGET = 21
const CAP = 27
const STATUS = {
  pending:   { label: 'Waiting for their confirmation', cls: 'bg-blue-100 text-blue-800' },
  confirmed: { label: 'Confirmed', cls: 'bg-green-100 text-green-800' },
  declined:  { label: 'Declined — back on the placeholder', cls: 'bg-red-100 text-red-800' },
}

/* ── swap dialog ─────────────────────────────────────────────────────────── */
function ReplaceModal({ ph, year, semester, onClose, onDone }) {
  const [pickedId, setPickedId] = useState(ph.suggestions[0]?.id ?? null)
  const [skipped, setSkipped]   = useState(new Set())      // entry ids the chair unticked
  const [reason, setReason]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [result, setResult]     = useState(null)

  const cand = ph.suggestions.find(s => s.id === pickedId)
  const eligible = new Set(cand?.eligible_entry_ids || [])
  const chosen = ph.subjects.flatMap(s => s.sections).filter(sec => eligible.has(sec.entry_id) && !skipped.has(sec.entry_id))
  const movable = chosen.reduce((a, sec) => a + sec.credit, 0)
  const projected = (cand?.current_units || 0) + movable
  const matched = (cand?.matched_subjects || []).length > 0
  const exception = !!cand && (projected > TARGET || !matched)
  const overCap = projected > CAP

  const submit = async () => {
    setSaving(true)
    try {
      const r = await placeholdersAPI.replace(ph.id, {
        instructor_id: pickedId, entry_ids: chosen.map(c => c.entry_id), reason, academic_year: year, semester,
      })
      setResult(r.data)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not complete the swap.', { duration: 7000 })
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
          <div className="px-6 py-4 bg-green-800 rounded-t-2xl flex items-center gap-2 text-white font-bold"><CheckCircle2 className="w-5 h-5" /> Swap complete</div>
          <div className="px-6 py-5 space-y-3 text-sm">
            <p className="text-gray-700">{result.message}</p>
            <p className="text-gray-600">{result.instructor} is now at <strong>{result.projected_units.toFixed(2)} units</strong>.</p>
            {result.rescheduled.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="font-semibold text-amber-900 mb-1">{result.rescheduled.length} subject{result.rescheduled.length > 1 ? 's were' : ' was'} moved to avoid a clash with their existing classes:</p>
                {result.rescheduled.map(r => (
                  <p key={r.entryId} className="text-xs text-amber-900 mt-1"><strong>{r.courseCode} {r.section}</strong>: {r.before.join('; ')} <ArrowRight className="inline w-3 h-3" /> {r.after.join('; ')}</p>
                ))}
              </div>
            )}
            {result.unresolved.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="font-semibold text-red-800 mb-1 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Needs a manual time slot:</p>
                {result.unresolved.map(u => <p key={u.entryId} className="text-xs text-red-800 mt-1"><strong>{u.courseCode} {u.section}</strong> — {u.reason}</p>)}
              </div>
            )}
            <p className="text-xs text-gray-500">Notified: {result.instructor} (to confirm), the Dean, the Registrar, and the students of the affected sections.</p>
            <button onClick={onDone} className="w-full bg-green-700 hover:bg-green-800 text-white font-bold py-2.5 rounded-xl text-sm">Done</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 bg-green-800 rounded-t-2xl sticky top-0">
          <div>
            <p className="text-white font-bold">Replace {ph.name} with a real instructor</p>
            <p className="text-green-300 text-xs mt-0.5">Approved subjects, sections and units stay exactly the same — only the instructor changes.</p>
          </div>
          <button onClick={onClose} className="text-green-300 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{ph.name} is holding</p>
            <ul className="text-sm text-gray-700 space-y-0.5">
              {ph.subjects.map(s => <li key={s.course_code}><span className="font-mono font-semibold text-green-800">{s.course_code}</span> {s.title} <span className="text-gray-400">× {s.sections.length} section{s.sections.length > 1 ? 's' : ''}</span></li>)}
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Choose who takes over</p>
            {ph.suggestions.length === 0 && <p className="text-sm text-gray-400">No other instructor in your department is available yet.</p>}
            <div className="space-y-2">
              {ph.suggestions.map(s => {
                const on = s.id === pickedId
                return (
                  <label key={s.id} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition ${on ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type="radio" name="cand" checked={on} onChange={() => setPickedId(s.id)} className="accent-green-700 mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-gray-800">{s.name}</span>
                        <span className="text-xs text-gray-400">{s.department}{s.role !== 'instructor' ? ` · ${s.role}` : ''}</span>
                        {s.matched_subjects.length > 0
                          ? <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800"><Sparkles className="w-3 h-3" /> Specialty match</span>
                          : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">No matching specialty</span>}
                      </div>
                      {s.matched_subjects.length > 0 && <p className="text-xs text-green-700 mt-0.5">Teaches: {s.matched_subjects.join(', ')}</p>}
                      <p className="text-xs text-gray-500 mt-0.5">Load {s.current_units.toFixed(2)} → {s.projected_units.toFixed(2)} units{!s.fits && <span className="text-red-600 font-semibold"> · over the {CAP}-unit cap (pick fewer sections)</span>}</p>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          {cand && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Sections to hand over</p>
              <div className="flex flex-wrap gap-2">
                {ph.subjects.flatMap(s => s.sections.map(sec => ({ ...sec, code: s.course_code }))).filter(sec => eligible.has(sec.entry_id)).map(sec => {
                  const on = !skipped.has(sec.entry_id)
                  return (
                    <button key={sec.entry_id} type="button" onClick={() => setSkipped(prev => { const n = new Set(prev); on ? n.add(sec.entry_id) : n.delete(sec.entry_id); return n })}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-lg border-2 transition ${on ? 'bg-green-700 border-green-700 text-white' : 'bg-white border-gray-200 text-gray-400 line-through'}`}>
                      {sec.code} · {sec.section}
                    </button>
                  )
                })}
              </div>
              <p className={`text-xs mt-2 font-semibold ${overCap ? 'text-red-600' : projected > TARGET ? 'text-amber-700' : 'text-green-700'}`}>
                {cand.name} would be at {projected.toFixed(2)} units{overCap ? ` — over the ${CAP}-unit cap, untick some sections` : projected > TARGET ? ` — above the standard ${TARGET}` : ''}.
              </p>
            </div>
          )}

          {exception && !overCap && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-900 mb-2">
                <strong>This is an exception</strong> ({projected > TARGET ? `over the standard ${TARGET}-unit load` : 'no matching specialty'}). Give a short reason — the Dean will see it flagged.
              </p>
              <input value={reason} onChange={e => setReason(e.target.value)} maxLength={255} placeholder="e.g. Only qualified IT instructor this term"
                className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 bg-white" />
            </div>
          )}

          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-900 leading-relaxed">
            No re-approval by the whole chain. {cand?.name || 'The instructor'} confirms their own load with one click; the Dean and the Registrar are notified and the swap is logged.
            If a subject would clash with a class they already teach, only that subject is moved to a free slot.
          </div>

          <div className="flex gap-3">
            <button onClick={submit} disabled={saving || !cand || overCap || chosen.length === 0 || (exception && reason.trim().length < 5)}
              className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Swapping…</> : <><UserCheck className="w-4 h-4" /> Replace {ph.name}</>}
            </button>
            <button onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl text-sm">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── the panel ───────────────────────────────────────────────────────────── */
export default function PlaceholdersPanel({ year, semester, refreshKey, onChanged }) {
  const [list, setList]       = useState([])
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [replacing, setReplacing] = useState(null)

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([placeholdersAPI.list(year, semester), placeholdersAPI.changes()])
      setList(p.data); setChanges(c.data)
    } catch { /* leave as is */ }
    finally { setLoading(false) }
  }, [year, semester])

  useEffect(() => { load() }, [load, refreshKey])

  if (loading || (list.length === 0 && changes.length === 0)) return null

  const hints = list.flatMap(ph => ph.suggestions.filter(s => s.matched_subjects.length > 0).slice(0, 1).map(s => ({ ph, s })))

  return (
    <div className="mb-6 bg-white rounded-2xl shadow-sm border-2 border-indigo-200 overflow-hidden">
      <div className="px-5 py-3 bg-indigo-50 border-b border-indigo-100">
        <h3 className="font-bold text-indigo-900 text-sm">Placeholder instructors</h3>
        <p className="text-xs text-indigo-700 mt-0.5">Stand-ins that hold subjects until a real instructor is found, so the load can still be approved and scheduled. When someone suitable arrives, swap them in.</p>
      </div>

      {hints.length > 0 && (
        <div className="px-5 py-3 bg-green-50 border-b border-green-100 space-y-1">
          {hints.map(({ ph, s }) => (
            <p key={`${ph.id}-${s.id}`} className="text-xs text-green-900 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-green-600 shrink-0" />
              <span><strong>{s.name}</strong> teaches {s.matched_subjects.join(', ')} — they can replace <strong>{ph.name}</strong>.</span>
            </p>
          ))}
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {list.map(ph => (
          <div key={ph.id} className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-gray-800 text-sm">{ph.name} <span className="ml-2 text-xs font-semibold text-gray-400">{ph.units.toFixed(2)} units</span></p>
              <p className="text-[11px] text-gray-400 mt-0.5 uppercase tracking-wide">Specialty basis — the subjects it holds</p>
              <ul className="mt-1 text-sm text-gray-700 space-y-0.5">
                {ph.subjects.map(s => (
                  <li key={s.course_code}><span className="font-mono font-semibold text-green-800 text-xs">{s.course_code}</span> {s.title}
                    <span className="text-gray-400 text-xs"> · {s.sections.map(x => x.section.split(' ').pop()).join(', ')}</span></li>
                ))}
              </ul>
            </div>
            <button onClick={() => setReplacing(ph)} disabled={ph.suggestions.length === 0}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-xl text-sm shrink-0">
              <UserCheck className="w-4 h-4" /> Replace with a real instructor
            </button>
          </div>
        ))}
      </div>

      {changes.length > 0 && (
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Recent swaps</p>
          <div className="space-y-1.5">
            {changes.slice(0, 5).map(c => {
              const st = STATUS[c.status]
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
                  <span><strong>{c.placeholder_name}</strong> <ArrowRight className="inline w-3 h-3 text-gray-400" /> <strong>{c.instructor_name}</strong>
                    <span className="text-gray-400"> · {new Date(c.created_at).toLocaleDateString()}</span>
                    {c.is_exception ? <span className="ml-1 text-amber-700 font-semibold" title={c.reason || ''}>· exception</span> : null}
                    {c.unresolved > 0 && <span className="ml-1 text-red-700 font-semibold">· {c.unresolved} need a time slot</span>}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{c.status === 'pending' && <Clock className="inline w-3 h-3 mr-0.5 -mt-0.5" />}{st.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {replacing && (
        <ReplaceModal ph={replacing} year={year} semester={semester}
          onClose={() => setReplacing(null)}
          onDone={() => { setReplacing(null); load(); onChanged?.() }} />
      )}
    </div>
  )
}
