const SCHEMES = {
  blue:   { wrap: 'border-blue-200',   icon: 'bg-blue-100 text-blue-700',    val: 'text-blue-800',   label: 'text-blue-500' },
  green:  { wrap: 'border-green-200',  icon: 'bg-green-100 text-green-700',  val: 'text-green-800',  label: 'text-green-600' },
  yellow: { wrap: 'border-yellow-200', icon: 'bg-yellow-100 text-yellow-700',val: 'text-yellow-800', label: 'text-yellow-600' },
  red:    { wrap: 'border-red-200',    icon: 'bg-red-100 text-red-600',      val: 'text-red-700',    label: 'text-red-500' },
  purple: { wrap: 'border-purple-200', icon: 'bg-purple-100 text-purple-700',val: 'text-purple-800', label: 'text-purple-500' },
  orange: { wrap: 'border-orange-200', icon: 'bg-orange-100 text-orange-600',val: 'text-orange-800', label: 'text-orange-500' },
  gold:   { wrap: 'border-amber-200',  icon: 'bg-amber-100 text-amber-700',  val: 'text-amber-800',  label: 'text-amber-600' },
  teal:   { wrap: 'border-teal-200',   icon: 'bg-teal-100 text-teal-700',    val: 'text-teal-800',   label: 'text-teal-600' },
}

export default function StatCard({ label, value, icon: Icon, color = 'green', sub }) {
  const s = SCHEMES[color] || SCHEMES.green
  return (
    <div className={`rounded-2xl border bg-white shadow-sm p-5 flex items-center gap-4 ${s.wrap}`}>
      {Icon && (
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${s.icon}`}>
          <Icon className="w-6 h-6" />
        </div>
      )}
      <div>
        <p className={`text-2xl font-bold ${s.val}`}>{value}</p>
        <p className={`text-sm font-medium ${s.label}`}>{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
