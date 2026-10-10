import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { crossDeptChainAPI, facultyLoadAPI } from '../../services/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { creditOf } from '../../utils/unitCredit.js'
import { Loader2, Check, X, ArrowRight, Undo2, Inbox } from 'lucide-react'

const SEM = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' }

// Borrowing an instructor from another college: Chair A -> Dean A -> Dean B ->
// Chair B -> Instructor, with a decline at the instructor stage looping back
// to Chair B only (try someone else) rather than restarting the whole chain.
const STAGE = {
  pending_dean_a:    { label: "Waiting for the requester's Dean", cls: 'bg-amber-100 text-amber-800' },
  pending_dean_b:    { label: "Waiting for the other college's Dean", cls: 'bg-amber-100 text-amber-800' },
  pending_chair_b:   { label: 'Waiting for a Program Chair to pick someone', cls: 'bg-blue-100 text-blue-800' },
  pending_instructor:{ label: 'Waiting for the instructor', cls: 'bg-blue-100 text-blue-800' },
  finalized:         { label: 'Finalized — added to their load', cls: 'bg-green-100 text-green-800' },
  declined:          { label: 'Declined', cls: 'bg-red-100 text-red-800' },
  cancelled:         { label: 'Withdrawn', cls: 'bg-gray-100 text-gray-600' },
}
const DECLINE_STAGE_LABEL = { dean_a: 'your Dean', dean_b: "the other college's Dean", instructor: 'the instructor' }

function StageBadge({ r }) {
  const s = STAGE[r.stage] || STAGE.cancelled
  return <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${s.cls}`}>{s.label}</span>
}

function Subject({ r }) {
  return (
    <div>
      <p className="font-mono font-bold text-sm text-green-800">{r.course_code} <span className="font-sans font-normal text-gray-700">— {r.descriptive_title}</span></p>
      <p className="text-xs text-gray-500 mt-0.5">
        {r.program_yr_sec} · {r.units} units · {r.lec_hours}h lec{r.lab_hours > 0 ? ` · ${r.lab_hours}h lab` : ''} · {SEM[r.semester]} A.Y. {r.academic_year}
      </p>
    </div>
  )
}

function Card({ children }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-3">{children}</div>
}

// Accept/decline (or approve/decline) row with a reason required for declining.
function Actions({ yes, no, busy, onYes, onNo }) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  if (declining) {
    return (
      <div className="flex flex-wrap gap-2 items-center">
        <input autoFocus value={reason} onChange={e => setReason(e.target.value)} maxLength={255} placeholder="Reason — required, they'll see it"
          className="flex-1 min-w-[220px] border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
        <button disabled={busy || !reason.trim()} onClick={() => onNo(reason)} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold rounded-xl text-sm">Confirm decline</button>
        <button onClick={() => setDeclining(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm">Back</button>
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <button disabled={busy} onClick={onYes} className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-semibold rounded-xl text-sm">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {yes}
      </button>
      <button disabled={busy} onClick={() => setDeclining(true)} className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-red-50 border-2 border-red-200 text-red-700 font-semibold rounded-xl text-sm">
        <X className="w-4 h-4" /> {no}
      </button>
    </div>
  )
}

// Chair B's picker — a willing instructor from their own department, with a
// live view of the unit load this would add (the server enforces the cap too).
function AssignInstructor({ r, busy, onAssign }) {
  const [instructors, setInstructors] = useState([])
  const [pickId, setPickId] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    facultyLoadAPI.getAllInstructors(r.academic_year, r.semester)
      .then(res => setInstructors(res.data.filter(i => i.department === r.target_department)))
      .catch(() => setInstructors([]))
  }, [r.academic_year, r.semester, r.target_department])

  const picked = instructors.find(i => String(i.id) === String(pickId))
  const add = creditOf(r)
  const projected = picked ? picked.current_units + add : null
  const willExceed = picked && projected > 27

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-2">
      <select value={pickId} onChange={e => setPickId(e.target.value)}
        className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
        <option value="">— Pick a willing instructor from {r.target_department} —</option>
        {instructors.map(i => (
          <option key={i.id} value={i.id}>{i.name}{i.role !== 'instructor' ? ` (${i.role})` : ''} — {i.current_units.toFixed(2)} units loaded</option>
        ))}
      </select>
      {picked && (
        <p className={`text-xs ${willExceed ? 'text-red-700' : 'text-blue-800'}`}>
          {picked.name}: {picked.current_units.toFixed(2)} <ArrowRight className="inline w-3 h-3 -mt-0.5" /> {projected.toFixed(2)} units
          {willExceed && ' — over the 27-unit cap, pick someone else.'}
        </p>
      )}
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={255}
        placeholder="Note to the instructor (optional)"
        className="w-full border-2 border-blue-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500 bg-white" />
      <button disabled={busy || !pickId || willExceed} onClick={() => onAssign(pickId, note)}
        className="flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white font-semibold rounded-xl text-sm">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Ask this instructor
      </button>
    </div>
  )
}

export default function TeachingRequests() {
  const { user } = useAuth()
  const isChair = user.role === 'chair'
  const isDean = user.role === 'dean'

  const [mine, setMine]       = useState([])
  const [deanInbox, setDeanInbox] = useState({ asDeanA: [], asDeanB: [], recent: [] })
  const [toAssign, setToAssign]   = useState([])
  const [toAnswer, setToAnswer]   = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId]   = useState(null)

  const load = useCallback(async () => {
    try {
      const [m, d, a, ans] = await Promise.all([
        isChair ? crossDeptChainAPI.mine() : Promise.resolve({ data: [] }),
        isDean ? crossDeptChainAPI.deanInbox() : Promise.resolve({ data: { asDeanA: [], asDeanB: [], recent: [] } }),
        isChair ? crossDeptChainAPI.toAssign() : Promise.resolve({ data: [] }),
        crossDeptChainAPI.toAnswer(),
      ])
      setMine(m.data); setDeanInbox(d.data); setToAssign(a.data); setToAnswer(ans.data)
    } catch {
      toast.error('Failed to load requests.')
    } finally {
      setLoading(false)
    }
  }, [isChair, isDean])

  useEffect(() => { load() }, [load])

  const run = async (id, fn) => {
    setBusyId(id)
    try {
      const res = await fn()
      toast.success(res.data.message, { duration: 6000 })
      await load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Something went wrong.', { duration: 6000 })
    } finally {
      setBusyId(null)
    }
  }

  const openMine = mine.filter(r => !['finalized', 'declined', 'cancelled'].includes(r.stage))
  const decidedMine = mine.filter(r => ['finalized', 'declined', 'cancelled'].includes(r.stage))

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…</div>

  return (
    <div className="space-y-8">
      <PageHeader
        title="Teaching Requests"
        subtitle="Borrowing an instructor from another college goes through both Deans first: your Dean, then theirs, then one of their Program Chairs picks a willing instructor."
      />

      {/* Dean: requests from my own chairs, waiting on me as Dean A */}
      {isDean && (
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Requests from my chairs ({deanInbox.asDeanA.length})</h2>
          <p className="text-xs text-gray-400 mb-3">One of your chairs wants to borrow an instructor from another college. Approving forwards this to that college's Dean.</p>
          {deanInbox.asDeanA.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 py-8 text-center text-sm text-gray-400">Nothing waiting.</div>
          ) : (
            <div className="space-y-3">
              {deanInbox.asDeanA.map(r => (
                <Card key={r.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Subject r={r} />
                    <span className="text-xs text-gray-500">From <strong className="text-gray-700">{r.requested_by_name}</strong> → asking <strong className="text-gray-700">{r.target_department}</strong></span>
                  </div>
                  {r.note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">"{r.note}"</p>}
                  <Actions yes="Approve" no="Decline" busy={busyId === r.id}
                    onYes={() => run(r.id, () => crossDeptChainAPI.deanAAct(r.id, 'approve'))}
                    onNo={reason => run(r.id, () => crossDeptChainAPI.deanAAct(r.id, 'decline', reason))} />
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Dean: requests from other colleges, waiting on me as Dean B */}
      {isDean && (
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Requests from other colleges ({deanInbox.asDeanB.length})</h2>
          <p className="text-xs text-gray-400 mb-3">Another college's Dean already approved this — approving hands it to one of your Program Chairs to pick a willing instructor.</p>
          {deanInbox.asDeanB.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 py-8 text-center text-sm text-gray-400">Nothing waiting.</div>
          ) : (
            <div className="space-y-3">
              {deanInbox.asDeanB.map(r => (
                <Card key={r.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Subject r={r} />
                    <span className="text-xs text-gray-500"><strong className="text-gray-700">{r.requester_department}</strong> needs an instructor</span>
                  </div>
                  {r.note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">"{r.note}"</p>}
                  <Actions yes="Approve" no="Decline" busy={busyId === r.id}
                    onYes={() => run(r.id, () => crossDeptChainAPI.deanBAct(r.id, 'approve'))}
                    onNo={reason => run(r.id, () => crossDeptChainAPI.deanBAct(r.id, 'decline', reason))} />
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Chair: queue where I'm Chair B and need to pick an instructor */}
      {isChair && (
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Assign an instructor ({toAssign.length})</h2>
          <p className="text-xs text-gray-400 mb-3">Both Deans approved — pick a willing instructor from your department. If they decline, you'll be asked to pick again.</p>
          {toAssign.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 py-8 text-center text-sm text-gray-400">Nothing waiting.</div>
          ) : (
            <div className="space-y-3">
              {toAssign.map(r => (
                <Card key={r.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Subject r={r} />
                    <span className="text-xs text-gray-500">For <strong className="text-gray-700">{r.requester_department}</strong>, requested by {r.requested_by_name}</span>
                  </div>
                  {r.note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">"{r.note}"</p>}
                  <AssignInstructor r={r} busy={busyId === r.id}
                    onAssign={(instructor_id, note) => run(r.id, () => crossDeptChainAPI.assign(r.id, instructor_id, note))} />
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Anyone: asked to teach for another college */}
      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Asked to teach for another college ({toAnswer.length})</h2>
        {toAnswer.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center py-10 text-gray-400">
            <Inbox className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No one is waiting on an answer from you.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {toAnswer.map(r => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Subject r={r} />
                  <span className="text-xs text-gray-500">From <strong className="text-gray-700">{r.chair_b_name}</strong> · for {r.requester_department}</span>
                </div>
                {r.note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">"{r.note}"</p>}
                <Actions yes="Accept" no="Decline" busy={busyId === r.id}
                  onYes={() => run(r.id, () => crossDeptChainAPI.respond(r.id, 'accept'))}
                  onNo={reason => run(r.id, () => crossDeptChainAPI.respond(r.id, 'decline', reason))} />
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Chair: requests I've sent to my own Dean */}
      {isChair && (
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">My requests ({openMine.length} open)</h2>
          <p className="text-xs text-gray-400 mb-3">Start a new one from an unassigned subject in Faculty Load.</p>
          {mine.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 py-8 text-center text-sm text-gray-400">You haven't asked another college for an instructor yet.</div>
          ) : (
            <div className="space-y-2">
              {[...openMine, ...decidedMine].map(r => (
                <div key={r.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800"><span className="font-mono font-semibold text-green-800">{r.course_code}</span> {r.program_yr_sec}
                      <span className="text-gray-500"> → {r.target_department}{r.instructor_name ? ` (asked ${r.instructor_name})` : ''}</span></p>
                    {r.stage === 'declined' && r.decline_reason && (
                      <p className="text-xs text-red-700 mt-0.5">Declined by {DECLINE_STAGE_LABEL[r.decline_stage] || 'them'}: "{r.decline_reason}"</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <StageBadge r={r} />
                    {!['finalized', 'declined', 'cancelled'].includes(r.stage) && (
                      <button disabled={busyId === r.id} onClick={() => run(r.id, () => crossDeptChainAPI.cancel(r.id))}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">
                        <Undo2 className="w-3.5 h-3.5" /> Withdraw
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
