import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { crossDeptAPI } from '../../services/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Loader2, Check, X, ArrowRight, Undo2, Inbox, Send, KeyRound } from 'lucide-react'

const SEM = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' }

const ACCESS_STATUS = {
  pending:   { label: "Waiting for the Dean's approval", cls: 'bg-amber-100 text-amber-800' },
  approved:  { label: 'Approved — you can pick their instructors', cls: 'bg-green-100 text-green-800' },
  declined:  { label: 'Declined', cls: 'bg-red-100 text-red-800' },
  cancelled: { label: 'Withdrawn', cls: 'bg-gray-100 text-gray-600' },
}

const STATUS = {
  pending_instructor: { label: 'Waiting for the instructor', cls: 'bg-blue-100 text-blue-800' },
  pending_home:       { label: "Waiting for the instructor's department", cls: 'bg-amber-100 text-amber-800' },
  approved:           { label: 'Approved — added to their load', cls: 'bg-green-100 text-green-800' },
  declined:           { label: 'Declined', cls: 'bg-red-100 text-red-800' },
  cancelled:          { label: 'Withdrawn', cls: 'bg-gray-100 text-gray-600' },
}

function StatusBadge({ r }) {
  const s = STATUS[r.status] || STATUS.cancelled
  const who = r.status === 'declined' ? (r.declined_stage === 'home' ? ` by ${r.instructor_dept}` : ` by ${r.instructor_name}`) : ''
  return <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${s.cls}`}>{s.label}{who}</span>
}

// Current -> projected load, coloured against the 21-unit standard load and the 27-unit hard cap.
function LoadEffect({ r }) {
  const over = r.projected_units > r.max_units
  const warn = r.projected_units > r.target_units
  return (
    <div className={`text-xs rounded-lg px-3 py-2 ${over ? 'bg-red-50 text-red-800' : warn ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
      <span className="font-semibold">{r.instructor_name}'s load:</span>{' '}
      {r.current_units.toFixed(2)} <ArrowRight className="inline w-3 h-3 -mt-0.5" /> <strong>{r.projected_units.toFixed(2)}</strong> units
      <span className="opacity-75"> (+{r.unit_credit.toFixed(2)} for this subject · standard {r.target_units}, cap {r.max_units})</span>
      {over && <span className="block font-semibold mt-0.5">Over the cap — this can't be accepted.</span>}
      {!over && warn && <span className="block mt-0.5">Above the standard {r.target_units}-unit load.</span>}
    </div>
  )
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

// Accept/decline (or approve/decline) row with an optional reason for declining.
function Actions({ yes, no, busy, canYes = true, onYes, onNo }) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  if (declining) {
    return (
      <div className="flex flex-wrap gap-2 items-center">
        <input autoFocus value={reason} onChange={e => setReason(e.target.value)} maxLength={255} placeholder="Reason (optional, the chair will see it)"
          className="flex-1 min-w-[220px] border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
        <button disabled={busy} onClick={() => onNo(reason)} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold rounded-xl text-sm">Confirm decline</button>
        <button onClick={() => setDeclining(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm">Back</button>
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <button disabled={busy || !canYes} onClick={onYes} className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-semibold rounded-xl text-sm">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {yes}
      </button>
      <button disabled={busy} onClick={() => setDeclining(true)} className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-red-50 border-2 border-red-200 text-red-700 font-semibold rounded-xl text-sm">
        <X className="w-4 h-4" /> {no}
      </button>
    </div>
  )
}

export default function TeachingRequests() {
  const { user } = useAuth()
  const canApprove = ['chair', 'dean'].includes(user.role)
  const isChair = user.role === 'chair'

  const [mine, setMine]   = useState([])
  const [home, setHome]   = useState({ pending: [], recent: [] })
  const [sent, setSent]   = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId]   = useState(null)

  // Department access (chair -> other college's Dean)
  const [accSent, setAccSent]         = useState([])
  const [accIncoming, setAccIncoming] = useState({ pending: [], recent: [] })
  const [accDepts, setAccDepts]       = useState([])
  const [accForm, setAccForm]         = useState({ target_department: '', academic_year: '2026-2027', semester: 1, note: '' })

  const load = useCallback(async () => {
    try {
      const [m, h, s, aSent, aIn] = await Promise.all([
        crossDeptAPI.mine(),
        canApprove ? crossDeptAPI.home() : Promise.resolve({ data: { pending: [], recent: [] } }),
        isChair ? crossDeptAPI.sent() : Promise.resolve({ data: [] }),
        isChair ? crossDeptAPI.accessSent() : Promise.resolve({ data: [] }),
        canApprove ? crossDeptAPI.accessIncoming() : Promise.resolve({ data: { pending: [], recent: [] } }),
      ])
      setMine(m.data); setHome(h.data); setSent(s.data); setAccSent(aSent.data); setAccIncoming(aIn.data)
    } catch {
      toast.error('Failed to load requests.')
    } finally {
      setLoading(false)
    }
  }, [canApprove, isChair])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!isChair) return
    crossDeptAPI.accessDepartments(accForm.academic_year, accForm.semester)
      .then(r => setAccDepts(r.data)).catch(() => {})
  }, [isChair, accForm.academic_year, accForm.semester, accSent])

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

  const sendAccess = async () => {
    if (!accForm.target_department) return toast.error('Choose a college first.')
    setBusyId('access')
    try {
      const res = await crossDeptAPI.accessRequest(accForm)
      toast.success(res.data.message, { duration: 6000 })
      setAccForm(f => ({ ...f, target_department: '', note: '' }))
      await load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Something went wrong.', { duration: 6000 })
    } finally {
      setBusyId(null)
    }
  }

  const openMine = mine.filter(r => r.status === 'pending_instructor')
  const decidedMine = mine.filter(r => r.status !== 'pending_instructor')

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…</div>

  return (
    <div className="space-y-8">
      <PageHeader
        title="Teaching Requests"
        subtitle="Borrowing an instructor from another college: first the Dean of that college approves your request, then you pick an instructor, then the instructor accepts."
      />

      {/* 0a. Chair: ask another college's Dean for access */}
      {isChair && (
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Ask another college for instructors</h2>
          <p className="text-xs text-gray-400 mb-3">Step 1. Once that college's Dean approves, their instructors appear under “Other departments” when you assign a subject in Faculty Load.</p>
          <Card>
            <div className="grid sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">College / department</label>
                <select value={accForm.target_department} onChange={e => setAccForm(f => ({ ...f, target_department: e.target.value }))}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-green-500">
                  <option value="">— Choose —</option>
                  {accDepts.map(d => (
                    <option key={d.department} value={d.department} disabled={!!d.status || !d.has_approver}>
                      {d.department}{d.status === 'approved' ? ' (approved)' : d.status === 'pending' ? ' (pending)' : !d.has_approver ? ' (no Dean account yet)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Academic year</label>
                <input value={accForm.academic_year} onChange={e => setAccForm(f => ({ ...f, academic_year: e.target.value }))}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Semester</label>
                <select value={accForm.semester} onChange={e => setAccForm(f => ({ ...f, semester: Number(e.target.value) }))}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-green-500">
                  {Object.entries(SEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <input value={accForm.note} onChange={e => setAccForm(f => ({ ...f, note: e.target.value }))} maxLength={255}
              placeholder="Why do you need them? e.g. no available IT instructor for our GE-Elective subjects"
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
            <button disabled={busyId === 'access'} onClick={sendAccess}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-semibold rounded-xl text-sm">
              {busyId === 'access' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send request to the Dean
            </button>
            {accSent.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-100">
                {accSent.map(a => {
                  const st = ACCESS_STATUS[a.status] || ACCESS_STATUS.cancelled
                  return (
                    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800 font-semibold">{a.target_department} <span className="font-normal text-gray-400">· {SEM[a.semester]} A.Y. {a.academic_year}</span></p>
                        {a.status === 'declined' && a.decline_reason && <p className="text-xs text-red-700">“{a.decline_reason}”</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                        {a.status === 'pending' && (
                          <button disabled={busyId === `a${a.id}`} onClick={() => run(`a${a.id}`, () => crossDeptAPI.accessCancel(a.id))}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">
                            <Undo2 className="w-3.5 h-3.5" /> Withdraw
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </section>
      )}

      {/* 0b. Dean: approve access to my college's instructors */}
      {canApprove && (accIncoming.pending.length > 0 || accIncoming.recent.length > 0) && (
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Chairs asking for my college's instructors ({accIncoming.pending.length})</h2>
          <p className="text-xs text-gray-400 mb-3">If you approve, that chair can pick willing instructors from your college for the term. Each instructor still has to accept, and their load is capped — you won't be asked again per subject.</p>
          <div className="space-y-3">
            {accIncoming.pending.map(a => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm text-gray-800"><KeyRound className="inline w-4 h-4 -mt-0.5 mr-1 text-green-700" />
                    <strong>{a.requester_name}</strong> <span className="text-gray-500">({a.requester_dept})</span> wants to borrow instructors from {a.target_department}
                  </p>
                  <span className="text-xs text-gray-500">{SEM[a.semester]} A.Y. {a.academic_year}</span>
                </div>
                {a.note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">“{a.note}”</p>}
                <Actions yes="Approve" no="Decline" busy={busyId === `a${a.id}`}
                  onYes={() => run(`a${a.id}`, () => crossDeptAPI.accessAct(a.id, 'approve'))}
                  onNo={reason => run(`a${a.id}`, () => crossDeptAPI.accessAct(a.id, 'decline', reason))} />
              </Card>
            ))}
            {accIncoming.recent.slice(0, 5).map(a => {
              const st = ACCESS_STATUS[a.status] || ACCESS_STATUS.cancelled
              return (
                <div key={a.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-gray-700">{a.requester_name} <span className="text-gray-400">· {a.requester_dept} · {SEM[a.semester]} {a.academic_year}</span></p>
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 1. Requests asking ME to teach */}
      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Asking me to teach ({openMine.length})</h2>
        {openMine.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 flex flex-col items-center py-10 text-gray-400">
            <Inbox className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No one is waiting on an answer from you.</p>
            <p className="text-xs mt-1 max-w-md text-center">To be asked by other departments, tick "I'm open to teaching for other departments" on My Specialty.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {openMine.map(r => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Subject r={r} />
                  <span className="text-xs text-gray-500">From <strong className="text-gray-700">{r.chair_name}</strong> · {r.chair_dept}</span>
                </div>
                {r.note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">“{r.note}”</p>}
                <LoadEffect r={r} />
                <p className="text-xs text-gray-500">
                  {r.dept_approved
                    ? `The Dean of ${r.instructor_dept} already approved this chair's request, so it's added to your load as soon as you accept.`
                    : `If you accept, it goes to your department (${r.instructor_dept}) for approval. It's only added to your load once they approve.`}
                </p>
                <Actions yes="Accept" no="Decline" busy={busyId === r.id} canYes={r.projected_units <= r.max_units}
                  onYes={() => run(r.id, () => crossDeptAPI.respond(r.id, 'accept'))}
                  onNo={reason => run(r.id, () => crossDeptAPI.respond(r.id, 'decline', reason))} />
              </Card>
            ))}
          </div>
        )}
        {decidedMine.length > 0 && (
          <div className="mt-4 space-y-2">
            {decidedMine.slice(0, 8).map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-700"><span className="font-mono font-semibold text-green-800">{r.course_code}</span> {r.program_yr_sec} <span className="text-gray-400">· from {r.chair_dept}</span></p>
                <StatusBadge r={r} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. Waiting on MY department */}
      {canApprove && (
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Awaiting my department's approval ({home.pending.length})</h2>
          <p className="text-xs text-gray-400 mb-3">Someone from your department has agreed to teach for another college. It takes units from your department's faculty, so it needs your sign-off.</p>
          {home.pending.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 py-8 text-center text-sm text-gray-400">Nothing waiting for approval.</div>
          ) : (
            <div className="space-y-3">
              {home.pending.map(r => (
                <Card key={r.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Subject r={r} />
                    <span className="text-xs text-gray-500">Requested by <strong className="text-gray-700">{r.chair_name}</strong> · {r.chair_dept}</span>
                  </div>
                  <p className="text-sm text-gray-700"><strong>{r.instructor_name}</strong> accepted and would teach this for {r.chair_dept}.</p>
                  {r.note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">“{r.note}”</p>}
                  <LoadEffect r={r} />
                  <Actions yes="Approve" no="Decline" busy={busyId === r.id}
                    onYes={() => run(r.id, () => crossDeptAPI.homeAct(r.id, 'approve'))}
                    onNo={reason => run(r.id, () => crossDeptAPI.homeAct(r.id, 'decline', reason))} />
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 3. Requests I sent (chairs) */}
      {isChair && (
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Requests I sent ({sent.length})</h2>
          <p className="text-xs text-gray-400 mb-3">After the Dean approves your request above, edit a subject in Faculty Load and pick an instructor under “Other departments”.</p>
          {sent.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 py-8 text-center text-sm text-gray-400">You haven't asked anyone from another department yet.</div>
          ) : (
            <div className="space-y-2">
              {sent.map(r => (
                <div key={r.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800"><span className="font-mono font-semibold text-green-800">{r.course_code}</span> {r.program_yr_sec}
                      <span className="text-gray-500"> → {r.instructor_name} <span className="text-gray-400">({r.instructor_dept})</span></span></p>
                    {r.status === 'declined' && r.decline_reason && <p className="text-xs text-red-700 mt-0.5">“{r.decline_reason}”</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge r={r} />
                    {['pending_instructor', 'pending_home'].includes(r.status) && (
                      <button disabled={busyId === r.id} onClick={() => run(r.id, () => crossDeptAPI.cancel(r.id))}
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
