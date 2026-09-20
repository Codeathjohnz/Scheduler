import { useState } from 'react'
import { Plus, Check } from 'lucide-react'

// Pick which program(s) an instructor teaches for — e.g. BSIT, BSIS, or both.
// `options` are the programs already known for the department; anything else
// can be typed in and added. `value` is an array of program names; an empty
// array means "not restricted" (eligible for every program in the department).
export default function ProgramPicker({ value = [], onChange, options = [] }) {
  const [custom, setCustom] = useState('')

  const known = [...options]
  for (const v of value) if (!known.some(o => o.toUpperCase() === v.toUpperCase())) known.push(v)

  const isOn = (p) => value.some(v => v.toUpperCase() === p.toUpperCase())
  const toggle = (p) => onChange(isOn(p) ? value.filter(v => v.toUpperCase() !== p.toUpperCase()) : [...value, p])

  const addCustom = () => {
    const p = custom.trim().toUpperCase()
    if (!p) return
    if (!isOn(p)) onChange([...value, p])
    setCustom('')
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {known.length === 0 && <p className="text-xs text-gray-400">No programs listed yet — type one below (e.g. BSIT).</p>}
        {known.map(p => (
          <button key={p} type="button" onClick={() => toggle(p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition ${
              isOn(p) ? 'bg-green-700 border-green-700 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-green-400'
            }`}>
            {isOn(p) && <Check className="w-3 h-3" />}{p}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <input value={custom} onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
          placeholder="Add another program…"
          className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-green-500" />
        <button type="button" onClick={addCustom}
          className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition">
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-1.5">
        Pick one program, or several if they teach for more than one. Leave everything unselected for no restriction.
      </p>
    </div>
  )
}
