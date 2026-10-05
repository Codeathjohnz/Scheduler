import { useState } from 'react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { usersAPI } from '../../services/api.js'
import { readClassListFile, combineClassLists, isInstitutionalEmail } from '../../utils/classList.js'
import { X, Upload, Loader2, Download, CheckCircle2, AlertTriangle } from 'lucide-react'

/**
 * Registrar: import students from the class-list spreadsheets. Pick one or more
 * files, review the preview, then import. Each student gets an account with a
 * random starting password, shown once in a downloadable sheet.
 */
export default function StudentImportModal({ onClose, onImported }) {
  const [files, setFiles]       = useState([])        // parsed class lists
  const [summary, setSummary]   = useState(null)      // combined preview
  const [reading, setReading]   = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult]     = useState(null)      // { created, skipped }

  const onPick = async (e) => {
    const picked = [...e.target.files]
    e.target.value = ''
    if (!picked.length) return
    setReading(true)
    try {
      const parsed = []
      for (const f of picked) {
        const r = readClassListFile(await f.arrayBuffer())
        if (r.error) { toast.error(`${f.name}: ${r.error}`); continue }
        parsed.push({ name: f.name, ...r })
      }
      setFiles(parsed)
      setSummary(combineClassLists(parsed))
      setResult(null)
    } catch (err) {
      toast.error('Could not read those files. Use the class-list spreadsheets.')
    } finally {
      setReading(false)
    }
  }

  const toCreate  = summary ? summary.students.filter(s => isInstitutionalEmail(s.email)) : []
  const noEmail   = summary ? summary.students.filter(s => !isInstitutionalEmail(s.email)) : []

  const runImport = async () => {
    if (!toCreate.length) return
    setImporting(true)
    try {
      const payload = toCreate.map(s => ({
        student_id: s.student_id, last_name: s.last_name, first_name: s.first_name,
        middle_name: s.middle_name, email: s.email, section: s.section,
      }))
      const r = await usersAPI.importStudents(payload)
      setResult(r.data)
      toast.success(`${r.data.created.length} student account${r.data.created.length === 1 ? '' : 's'} created.`)
      onImported?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed. Nothing was half-saved beyond what is listed.')
    } finally {
      setImporting(false)
    }
  }

  const downloadCredentials = () => {
    const rows = result.created.map(c => ({
      'Student ID': c.student_id, 'Name': c.name, 'Section': c.section,
      'Email': c.email, 'Username': c.username, 'Starting password': c.password,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Students')
    XLSX.writeFile(wb, `Student_accounts_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 bg-green-800 rounded-t-2xl">
          <div>
            <p className="text-white font-bold">Import students from class lists</p>
            <p className="text-green-300 text-xs mt-0.5">Pick every class-list spreadsheet at once. Students in several sections are counted once.</p>
          </div>
          <button onClick={onClose} className="text-green-300 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {!result && (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl py-8 cursor-pointer hover:border-green-500 transition">
              {reading ? <Loader2 className="w-6 h-6 animate-spin text-gray-400" /> : <Upload className="w-6 h-6 text-gray-400" />}
              <span className="mt-2 text-sm font-semibold text-gray-600">{reading ? 'Reading files…' : 'Choose class-list files (.xlsx)'}</span>
              <input type="file" accept=".xlsx" multiple className="hidden" onChange={onPick} disabled={reading || importing} />
            </label>
          )}

          {summary && !result && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <Stat label="Files" value={files.length} />
                <Stat label="Students to create" value={toCreate.length} tone="green" />
                <Stat label="Not enrolled (all DROPPED)" value={summary.dropped} />
                <Stat label="Listed in 2+ sections" value={summary.duplicates} />
              </div>
              <p className="text-xs text-gray-500">
                Each student's account goes in their <strong>home section</strong>: the lowest year level they're listed in.
                The username is the part of their email before the @.
              </p>
              {noEmail.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
                  <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {noEmail.length} won't be created: not an @adssu.edu.ph address</p>
                  <ul className="mt-1 list-disc pl-5 max-h-24 overflow-y-auto">
                    {noEmail.slice(0, 50).map(s => <li key={s.student_id}>{s.student_id} {s.last_name} — {s.email || 'no email'}</li>)}
                  </ul>
                </div>
              )}
              <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0"><tr>
                    {['Student ID', 'Name', 'Section', 'Email'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {toCreate.slice(0, 200).map(s => (
                      <tr key={s.student_id}>
                        <td className="px-3 py-1.5 font-mono">{s.student_id}</td>
                        <td className="px-3 py-1.5">{[s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ')}</td>
                        <td className="px-3 py-1.5">{s.section.replace('-', ' ')}</td>
                        <td className="px-3 py-1.5 text-gray-500">{s.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {toCreate.length > 200 && <p className="text-[11px] text-gray-400 px-3 py-2">Showing the first 200 of {toCreate.length}.</p>}
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> <strong>{result.created.length}</strong> account{result.created.length === 1 ? '' : 's'} created. {result.skipped.length > 0 && <span>{result.skipped.length} skipped.</span>}
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Download the starting passwords now. They are shown only this once; hand each one to its student and keep the file private.
              </p>
              <button onClick={downloadCredentials} disabled={!result.created.length}
                className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-xl text-sm">
                <Download className="w-4 h-4" /> Download accounts and starting passwords
              </button>
              {result.skipped.length > 0 && (
                <div className="max-h-40 overflow-y-auto text-xs border border-gray-200 rounded-xl p-3">
                  <p className="font-bold text-gray-600 mb-1">Skipped</p>
                  <ul className="space-y-0.5">{result.skipped.map((s, i) => <li key={i}>{s.label}: {s.reason}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          {!result && summary && (
            <button onClick={runImport} disabled={importing || !toCreate.length}
              className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm">
              {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : `Import ${toCreate.length} student${toCreate.length === 1 ? '' : 's'}`}
            </button>
          )}
          <button onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl text-sm">
            {result ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${tone === 'green' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
      <p className={`text-lg font-bold ${tone === 'green' ? 'text-green-800' : 'text-gray-800'}`}>{value}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
    </div>
  )
}
