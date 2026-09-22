import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { roomsAPI, buildingPriorityAPI } from '../../services/api.js'
import toast from 'react-hot-toast'
import {
  Plus, Trash2, X, Loader2, DoorOpen, FlaskConical, MonitorPlay, Accessibility,
  ListOrdered, ArrowUp, ArrowDown, Pencil, Upload, FileSpreadsheet, Dumbbell, Lock,
} from 'lucide-react'

const PROGRAM_SUGGESTIONS = ['CCIS', 'BSIT', 'BSIS', 'General Education', 'CEIT', 'CON', 'CBPA', 'CTE', 'Office of the VPAA', "Registrar's Office"]

/* ─── Spreadsheet import helpers ──────────────────────────────
   Expected columns (case-insensitive, flexible naming):
     Building (optional per-row — falls back to the sheet-level default)
     Room / Room Number / Classroom(s)/Laboratory  (required)
     Capacity  (e.g. "50" or "50 Students")
     Room Type (Lecture/Laboratory/Special) — or derived from Remarks
     Remarks   (e.g. "For Lecture utilization")
     Floor / Floor Level
     Accessible (Yes/No)
*/
const HEADER_ALIASES = {
  building:    ['building', 'college', 'dept', 'department'],
  room:        ['room', 'roomnumber', 'roomno', 'classroom', 'classroomslaboratory', 'classroomlaboratory', 'name', 'roomname'],
  capacity:    ['capacity'],
  type:        ['roomtype', 'type'],
  remarks:     ['remarks', 'remark'],
  floor:       ['floor', 'floorlevel'],
  accessible:  ['accessible', 'isaccessible', 'wheelchair', 'wheelchairaccessible'],
}

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findKey(rowKeys, aliasList) {
  return rowKeys.find(k => aliasList.includes(normalizeHeader(k))) || null
}

function parseCapacity(val) {
  const m = String(val ?? '').match(/\d+/)
  return m ? parseInt(m[0], 10) : 40
}

function resolveRoomType(typeVal, remarksVal) {
  const t = String(typeVal || '').trim().toLowerCase()
  if (t === 'lecture') return 'Lecture'
  if (t === 'laboratory' || t === 'lab') return 'Laboratory'
  if (t === 'special') return 'Special'
  if (t === 'gym') return 'Gym'
  const r = String(remarksVal || '').toLowerCase()
  if (r.includes('lab')) return 'Laboratory'
  if (r.includes('gym')) return 'Gym'
  if (r.includes('lecture')) return 'Lecture'
  return 'Lecture'
}

function parseAccessible(val) {
  const v = String(val ?? '').trim().toLowerCase()
  return ['yes', 'y', '1', 'true', 'wheelchair'].includes(v) ? 1 : 0
}

function parseRoomSheet(rows) {
  if (!rows.length) return []
  const keys = Object.keys(rows[0])
  const buildingKey   = findKey(keys, HEADER_ALIASES.building)
  const roomKey       = findKey(keys, HEADER_ALIASES.room)
  const capacityKey   = findKey(keys, HEADER_ALIASES.capacity)
  const typeKey       = findKey(keys, HEADER_ALIASES.type)
  const remarksKey    = findKey(keys, HEADER_ALIASES.remarks)
  const floorKey      = findKey(keys, HEADER_ALIASES.floor)
  const accessibleKey = findKey(keys, HEADER_ALIASES.accessible)

  if (!roomKey) return []

  return rows
    .map(row => ({
      building:      buildingKey ? String(row[buildingKey] || '').trim() : '',
      room_number:   String(row[roomKey] || '').trim(),
      capacity:      capacityKey ? parseCapacity(row[capacityKey]) : 40,
      room_type:     resolveRoomType(typeKey && row[typeKey], remarksKey && row[remarksKey]),
      floor_level:   floorKey ? (parseInt(row[floorKey], 10) || 1) : 1,
      is_accessible: accessibleKey ? parseAccessible(row[accessibleKey]) : 0,
    }))
    .filter(r => r.room_number)
}

const TYPE_STYLES = {
  Lecture:    { chip: 'bg-blue-100 text-blue-700',   icon: MonitorPlay,  label: 'Lecture' },
  Laboratory: { chip: 'bg-purple-100 text-purple-700', icon: FlaskConical, label: 'Laboratory' },
  Special:    { chip: 'bg-amber-100 text-amber-700',  icon: DoorOpen,     label: 'Special' },
  Gym:        { chip: 'bg-emerald-100 text-emerald-700', icon: Dumbbell,  label: 'Gym' },
}

const EMPTY_FORM = {
  building: '', room_number: '', capacity: '',
  room_type: 'Lecture', floor_level: '1', is_accessible: false, program_restriction: '',
}

export default function AdminRooms() {
  const [rooms, setRooms]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)   // null = Add mode, else editing this room's id
  const [saving, setSaving]     = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [filterType, setFilterType]     = useState('all')
  const [filterBuilding, setFilterBuilding] = useState(null)   // null = every building

  const [priorities, setPriorities]     = useState({})
  const [editingBuilding, setEditingBuilding] = useState(null)
  const [draftPrograms, setDraftPrograms]     = useState([])
  const [newProgram, setNewProgram]           = useState('')
  const [savingPriority, setSavingPriority]   = useState(false)

  const roomFileRef = useRef(null)
  const [roomPreview, setRoomPreview]     = useState(null)   // parsed rows awaiting import
  const [defaultBuilding, setDefaultBuilding] = useState('')
  const [importingRooms, setImportingRooms]   = useState(false)

  const fetchRooms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await roomsAPI.getAll()
      setRooms(res.data)
    } catch {
      toast.error('Failed to load rooms.')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPriorities = useCallback(async () => {
    try {
      const res = await buildingPriorityAPI.getAll()
      setPriorities(res.data)
    } catch {
      toast.error('Failed to load building priorities.')
    }
  }, [])

  useEffect(() => { fetchRooms(); fetchPriorities() }, [fetchRooms, fetchPriorities])

  const buildings = [...new Set(rooms.map(r => r.building))].sort()

  const openPriorityEditor = (building) => {
    setEditingBuilding(building)
    setDraftPrograms((priorities[building] || []).map(p => p.program))
    setNewProgram('')
  }
  const closePriorityEditor = () => setEditingBuilding(null)

  const addDraftProgram = () => {
    const val = newProgram.trim()
    if (!val || draftPrograms.includes(val)) return
    setDraftPrograms(list => [...list, val])
    setNewProgram('')
  }
  const removeDraftProgram = (program) => {
    setDraftPrograms(list => list.filter(p => p !== program))
  }
  const moveDraftProgram = (index, dir) => {
    setDraftPrograms(list => {
      const next = [...list]
      const target = index + dir
      if (target < 0 || target >= next.length) return list
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const savePriorities = async () => {
    if (!editingBuilding) return
    setSavingPriority(true)
    try {
      await buildingPriorityAPI.set(editingBuilding, draftPrograms)
      toast.success(`Priority list saved for ${editingBuilding}.`)
      closePriorityEditor()
      fetchPriorities()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save priority list.')
    } finally {
      setSavingPriority(false)
    }
  }

  const openAdd = () => { setForm(EMPTY_FORM); setEditingId(null); setShowModal(true) }
  const openEdit = (room) => {
    setForm({
      building:      room.building,
      room_number:   room.room_number,
      capacity:      String(room.capacity),
      room_type:     room.room_type,
      floor_level:   String(room.floor_level ?? 1),
      is_accessible: !!room.is_accessible,
      program_restriction: room.program_restriction || '',
    })
    setEditingId(room.id)
    setShowModal(true)
  }
  const closeModal = () => setShowModal(false)

  const handleRoomFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        const parsed = parseRoomSheet(rows)
        if (!parsed.length) {
          toast.error('No rooms found. Make sure the sheet has a "Room" column.')
          return
        }
        setDefaultBuilding(parsed.find(r => r.building)?.building || '')
        setRoomPreview(parsed)
        toast.success(`Parsed ${parsed.length} rooms.`)
      } catch (err) {
        toast.error('Failed to read file: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file); e.target.value = ''
  }

  const handleImportRooms = async () => {
    if (!roomPreview) return
    setImportingRooms(true)
    try {
      const rows = roomPreview.map(r => ({ ...r, building: r.building || defaultBuilding.trim() }))
      const res = await roomsAPI.bulkCreate(rows)
      toast.success(`Imported ${res.data.count} room${res.data.count === 1 ? '' : 's'}.`)
      setRoomPreview(null)
      fetchRooms()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed.')
    } finally {
      setImportingRooms(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.building.trim() || !form.room_number.trim() || !form.capacity) {
      toast.error('Building, room number, and capacity are required.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        building:      form.building.trim(),
        room_number:   form.room_number.trim(),
        capacity:      Number(form.capacity),
        room_type:     form.room_type,
        floor_level:   Number(form.floor_level),
        is_accessible: form.is_accessible ? 1 : 0,
        program_restriction: form.program_restriction.trim() || null,
      }
      if (editingId) {
        await roomsAPI.update(editingId, payload)
        toast.success('Room updated.')
      } else {
        await roomsAPI.create(payload)
        toast.success('Room added.')
      }
      closeModal()
      fetchRooms()
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${editingId ? 'update' : 'add'} room.`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await roomsAPI.remove(deleteTarget.id)
      toast.success(`${deleteTarget.building} ${deleteTarget.room_number} removed.`)
      setDeleteTarget(null)
      fetchRooms()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete room.')
    }
  }

  const filtered = rooms.filter(r => (filterType === 'all' || r.room_type === filterType) && (!filterBuilding || r.building === filterBuilding))

  const counts = {
    total:      rooms.length,
    Lecture:    rooms.filter(r => r.room_type === 'Lecture').length,
    Laboratory: rooms.filter(r => r.room_type === 'Laboratory').length,
    Special:    rooms.filter(r => r.room_type === 'Special').length,
    Gym:        rooms.filter(r => r.room_type === 'Gym').length,
  }

  return (
    <div>
      <PageHeader
        title="Manage Rooms"
        subtitle="Add and manage classrooms and laboratories used in scheduling."
        action={
          <div className="flex gap-2">
            <button onClick={() => roomFileRef.current?.click()}
              className="flex items-center gap-2 bg-white hover:bg-gray-50 border-2 border-gray-200 text-gray-700 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
              <Upload className="w-4 h-4" /> Upload Spreadsheet
            </button>
            <input ref={roomFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleRoomFileChange} />
            <button onClick={openAdd}
              className="flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white font-semibold px-4 py-2.5 rounded-xl transition shadow text-sm">
              <Plus className="w-4 h-4" /> Add Room
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {[
          { key: 'all',        label: 'Total Rooms',  value: counts.total,      color: 'bg-gray-50 border-gray-200 text-gray-700' },
          { key: 'Lecture',    label: 'Lecture Rooms', value: counts.Lecture,   color: 'bg-blue-50 border-blue-100 text-blue-700' },
          { key: 'Laboratory', label: 'Laboratories',  value: counts.Laboratory, color: 'bg-purple-50 border-purple-100 text-purple-700' },
          { key: 'Special',    label: 'Special Rooms', value: counts.Special,    color: 'bg-amber-50 border-amber-100 text-amber-700' },
          { key: 'Gym',        label: 'Gyms',           value: counts.Gym,        color: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
        ].map(s => (
          <button key={s.key} onClick={() => setFilterType(s.key)}
            className={`rounded-xl border p-3 text-left transition ${s.color} ${filterType === s.key ? 'ring-2 ring-green-500' : ''}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium opacity-70 mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Building Priority */}
      {buildings.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <ListOrdered className="w-4 h-4 text-green-700" />
            <h3 className="font-bold text-gray-800 text-sm">Building Priority</h3>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Rank which programs get first use of each building's rooms when a schedule is generated.
            A building with no ranked programs stays open to every program.
          </p>
          {filterBuilding && (
            <p className="text-xs text-green-700 font-semibold mb-3">
              Showing rooms in {filterBuilding} only.{' '}
              <button onClick={() => setFilterBuilding(null)} className="underline hover:text-green-800">Show all buildings</button>
            </p>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {buildings.map(b => {
              const list = priorities[b] || []
              return (
                <div key={b} onClick={() => setFilterBuilding(fb => fb === b ? null : b)}
                  title={filterBuilding === b ? 'Click to show all buildings' : `Show only ${b} rooms`}
                  className={`border rounded-xl p-3.5 cursor-pointer transition ${filterBuilding === b ? 'border-green-500 ring-2 ring-green-500 bg-green-50/40' : 'border-gray-200 hover:border-green-300'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-gray-800 text-sm">{b} <span className="text-xs font-medium text-gray-400">· {rooms.filter(r => r.building === b).length} rooms</span></span>
                    <button onClick={e => { e.stopPropagation(); openPriorityEditor(b) }}
                      className="p-1.5 text-gray-400 hover:text-green-700 hover:bg-green-50 rounded-lg transition">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {list.length === 0 ? (
                    <p className="text-xs text-gray-400">Open to all programs</p>
                  ) : (
                    <ol className="space-y-1">
                      {list.map(p => (
                        <li key={p.program} className="flex items-center gap-2 text-xs">
                          <span className="w-4 h-4 rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center shrink-0 text-[10px]">
                            {p.priority}
                          </span>
                          <span className="text-gray-700 font-medium">{p.program}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading rooms…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <DoorOpen className="w-10 h-10 mb-3 opacity-30" />
            <p className="font-medium text-gray-500">No rooms found.</p>
            <p className="text-sm mt-1">Click <strong className="text-green-700">Add Room</strong> to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">#</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Room</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Building</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Floor</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Capacity</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Accessible</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Restricted To</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r, i) => {
                const ts = TYPE_STYLES[r.room_type] || TYPE_STYLES.Special
                const TypeIcon = ts.icon
                return (
                  <tr key={r.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ts.chip}`}>
                          <TypeIcon className="w-4 h-4" />
                        </div>
                        <span className="font-bold text-gray-800">{r.room_number}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-600 font-medium">{r.building}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ts.chip}`}>
                        {r.room_type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">Floor {r.floor_level ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600 font-semibold">{r.capacity}</td>
                    <td className="px-5 py-3">
                      {r.is_accessible ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
                          <Accessibility className="w-3.5 h-3.5" /> Yes
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {r.program_restriction ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-orange-700" title={`Only ${r.program_restriction} may use this room`}>
                          <Lock className="w-3.5 h-3.5" /> {r.program_restriction}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Open to all</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(r)}
                          className="p-1.5 text-gray-400 hover:text-green-700 hover:bg-green-50 rounded-lg transition">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteTarget(r)}
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

      {/* Add Room Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 bg-green-800 rounded-t-2xl">
              <div>
                <p className="text-white font-bold">{editingId ? 'Edit Room' : 'Add Room'}</p>
                <p className="text-green-300 text-xs mt-0.5">Fill in the room details</p>
              </div>
              <button onClick={closeModal} className="text-green-300 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Building <span className="text-red-500">*</span></label>
                  <input
                    required
                    value={form.building}
                    onChange={e => setForm(f => ({ ...f, building: e.target.value }))}
                    placeholder="e.g. CEIT"
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Room No. <span className="text-red-500">*</span></label>
                  <input
                    required
                    value={form.room_number}
                    onChange={e => setForm(f => ({ ...f, room_number: e.target.value }))}
                    placeholder="e.g. 101 or Lab 3"
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Room Type <span className="text-red-500">*</span></label>
                  <select value={form.room_type} onChange={e => setForm(f => ({ ...f, room_type: e.target.value }))}
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 bg-white">
                    <option value="Lecture">Lecture</option>
                    <option value="Laboratory">Laboratory</option>
                    <option value="Special">Special</option>
                    <option value="Gym">Gym</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Capacity <span className="text-red-500">*</span></label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={form.capacity}
                    onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                    placeholder="e.g. 40"
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Floor Level</label>
                  <select value={form.floor_level} onChange={e => setForm(f => ({ ...f, floor_level: e.target.value }))}
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 bg-white">
                    {['1','2','3','4','5'].map(n => <option key={n} value={n}>Floor {n}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer pb-1">
                  <input
                    type="checkbox"
                    checked={form.is_accessible}
                    onChange={e => setForm(f => ({ ...f, is_accessible: e.target.checked }))}
                    className="w-4 h-4 accent-green-700"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-700">Wheelchair Accessible</p>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Restrict To (optional)
                </label>
                <input
                  list="room-program-list"
                  value={form.program_restriction}
                  onChange={e => setForm(f => ({ ...f, program_restriction: e.target.value }))}
                  placeholder="e.g. CCIS, BSIT, BSIS — blank = open to everyone"
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500"
                />
                <datalist id="room-program-list">
                  {PROGRAM_SUGGESTIONS.map(p => <option key={p} value={p} />)}
                </datalist>
                <p className="text-xs text-gray-400 mt-1">
                  Comma-separated programs or departments allowed to use this room. Leave blank to keep it open to all.
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : editingId ? 'Update Room' : 'Save Room'}
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

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-center font-bold text-gray-800 mb-1">Remove Room</h3>
            <p className="text-center text-sm text-gray-500 mb-6">
              Remove <span className="font-semibold text-gray-700">{deleteTarget.building} {deleteTarget.room_number}</span>?
              This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={handleDelete}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl transition text-sm">
                Yes, Remove
              </button>
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Building Priority Editor */}
      {editingBuilding && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 bg-green-800 rounded-t-2xl">
              <div>
                <p className="text-white font-bold">Building Priority — {editingBuilding}</p>
                <p className="text-green-300 text-xs mt-0.5">1st priority is scheduled into this building first</p>
              </div>
              <button onClick={closePriorityEditor} className="text-green-300 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {draftPrograms.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-3">
                  No programs ranked yet — this building is open to all programs.
                </p>
              ) : (
                <ol className="space-y-2">
                  {draftPrograms.map((p, i) => (
                    <li key={p} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                      <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center shrink-0 text-[11px]">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-sm font-medium text-gray-700">{p}</span>
                      <button type="button" onClick={() => moveDraftProgram(i, -1)} disabled={i === 0}
                        className="p-1 text-gray-400 hover:text-green-700 disabled:opacity-30 disabled:hover:text-gray-400">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => moveDraftProgram(i, 1)} disabled={i === draftPrograms.length - 1}
                        className="p-1 text-gray-400 hover:text-green-700 disabled:opacity-30 disabled:hover:text-gray-400">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => removeDraftProgram(p)}
                        className="p-1 text-gray-400 hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              <div className="flex gap-2">
                <input
                  list="program-list"
                  value={newProgram}
                  onChange={e => setNewProgram(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDraftProgram() } }}
                  placeholder="Add a program…"
                  className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
                <datalist id="program-list">
                  {PROGRAM_SUGGESTIONS.map(p => <option key={p} value={p} />)}
                </datalist>
                <button type="button" onClick={addDraftProgram}
                  className="px-3.5 py-2 bg-green-700 hover:bg-green-800 text-white rounded-xl text-sm font-semibold transition">
                  Add
                </button>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={savePriorities} disabled={savingPriority}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                  {savingPriority ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Save Priority'}
                </button>
                <button type="button" onClick={closePriorityEditor}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Room Import Preview */}
      {roomPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 bg-green-800 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-green-300" />
                <div>
                  <p className="text-white font-bold">Import Rooms — Preview</p>
                  <p className="text-green-300 text-xs mt-0.5">{roomPreview.length} rooms parsed from the spreadsheet</p>
                </div>
              </div>
              <button onClick={() => setRoomPreview(null)} className="text-green-300 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Default Building <span className="text-gray-400 font-normal">(used for any row without its own Building column)</span>
                </label>
                <input
                  value={defaultBuilding}
                  onChange={e => setDefaultBuilding(e.target.value)}
                  placeholder="e.g. CA"
                  className="w-full max-w-xs border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-100 max-h-[50vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Building</th>
                      <th className="px-3 py-2 text-left">Room</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-center">Capacity</th>
                      <th className="px-3 py-2 text-center">Floor</th>
                      <th className="px-3 py-2 text-center">Accessible</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {roomPreview.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-700">
                          {r.building || <span className="text-amber-500 italic">{defaultBuilding || '— set default —'}</span>}
                        </td>
                        <td className="px-3 py-2 font-semibold text-green-800">{r.room_number}</td>
                        <td className="px-3 py-2 text-gray-600">{r.room_type}</td>
                        <td className="px-3 py-2 text-center text-gray-600">{r.capacity}</td>
                        <td className="px-3 py-2 text-center text-gray-500">{r.floor_level}</td>
                        <td className="px-3 py-2 text-center text-gray-500">{r.is_accessible ? 'Yes' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-gray-400">
                Re-uploading a sheet updates existing rooms with the same Building + Room instead of duplicating them.
              </p>

              <div className="flex gap-3 pt-1">
                <button onClick={handleImportRooms} disabled={importingRooms || (!defaultBuilding.trim() && roomPreview.some(r => !r.building))}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                  {importingRooms ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : `Import ${roomPreview.length} Rooms`}
                </button>
                <button onClick={() => setRoomPreview(null)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
