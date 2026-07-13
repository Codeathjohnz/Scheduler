import { useState } from 'react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import toast from 'react-hot-toast'
import { Plus, Trash2, Send } from 'lucide-react'

const INSTRUCTORS = ['Michelle Elape', 'Ignel Balmora', 'Nancy Jacobsen', 'Novie Balighot', 'Jay Velasquez']
const SUBJECTS = [
  { code: 'ITCC 102', title: 'Intermediate Programming', units: 3, lec: 2, lab: 3 },
  { code: 'IS 101', title: 'Organization and Management', units: 3, lec: 3, lab: 0 },
  { code: 'IS 102', title: 'Business Process Design', units: 3, lec: 3, lab: 0 },
  { code: 'GE 07', title: 'Science, Technology and Society', units: 3, lec: 3, lab: 0 },
  { code: 'GE 09', title: 'Life and Works of Rizal', units: 3, lec: 3, lab: 0 },
]

const emptyRow = () => ({ instructor: '', subject: '', section: '', program: '', yearLevel: '1', id: Date.now() + Math.random() })

export default function ChairSubmission() {
  const [rows, setRows] = useState([emptyRow()])

  const updateRow = (id, field, value) => {
    setRows(r => r.map(row => row.id === id ? { ...row, [field]: value } : row))
  }

  const addRow = () => setRows(r => [...r, emptyRow()])
  const removeRow = (id) => setRows(r => r.filter(row => row.id !== id))

  const handleSubmit = (e) => {
    e.preventDefault()
    const incomplete = rows.some(r => !r.instructor || !r.subject || !r.section)
    if (incomplete) { toast.error('Please complete all fields before submitting.'); return }
    toast.success('Submission sent to VPAA for review!')
  }

  return (
    <div>
      <PageHeader
        title="Submit Scheduling Data"
        subtitle="Encode instructor, subject, and section assignments then submit to VPAA."
        action={
          <button onClick={addRow}
            className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            <Plus className="w-4 h-4" /> Add Row
          </button>
        }
      />

      <form onSubmit={handleSubmit}>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Instructor</th>
                  <th className="px-4 py-3 text-left">Subject</th>
                  <th className="px-4 py-3 text-left">Program</th>
                  <th className="px-4 py-3 text-left">Year Level</th>
                  <th className="px-4 py-3 text-left">Section</th>
                  <th className="px-4 py-3 text-left"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <select value={row.instructor} onChange={e => updateRow(row.id, 'instructor', e.target.value)}
                        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="">Select instructor</option>
                        {INSTRUCTORS.map(i => <option key={i}>{i}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select value={row.subject} onChange={e => updateRow(row.id, 'subject', e.target.value)}
                        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="">Select subject</option>
                        {SUBJECTS.map(s => <option key={s.code} value={s.code}>{s.code} – {s.title}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select value={row.program} onChange={e => updateRow(row.id, 'program', e.target.value)}
                        className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="">Program</option>
                        <option>BSIS</option><option>BSIT</option><option>BSCS</option>
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select value={row.yearLevel} onChange={e => updateRow(row.id, 'yearLevel', e.target.value)}
                        className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                        {['1','2','3','4'].map(y => <option key={y}>{y}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input value={row.section} onChange={e => updateRow(row.id, 'section', e.target.value)}
                        placeholder="e.g. A"
                        className="w-16 border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-4 py-2">
                      <button type="button" onClick={() => removeRow(row.id)} disabled={rows.length === 1}
                        className="text-red-400 hover:text-red-600 disabled:opacity-30">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit"
            className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white font-semibold px-6 py-2.5 rounded-lg transition">
            <Send className="w-4 h-4" /> Submit to VPAA
          </button>
        </div>
      </form>
    </div>
  )
}
