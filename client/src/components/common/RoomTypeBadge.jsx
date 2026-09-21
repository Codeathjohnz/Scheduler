// Small LEC / LAB / SPECIAL / GYM tag for a room, so lab rooms are recognisable
// at a glance and not booked for lectures.
const TYPES = {
  Lecture:    { short: 'LEC', long: 'Lecture room',                 cls: 'bg-blue-100 text-blue-700' },
  Laboratory: { short: 'LAB', long: 'Laboratory — priority for lab classes', cls: 'bg-purple-100 text-purple-700' },
  Special:    { short: 'SPL', long: 'Special room',                 cls: 'bg-amber-100 text-amber-700' },
  Gym:        { short: 'GYM', long: 'Gym',                          cls: 'bg-orange-100 text-orange-700' },
}

export const roomTypeShort = (t) => TYPES[t]?.short || ''
export const roomTypeLong  = (t) => TYPES[t]?.long || ''

// A lecture sitting in a lab room (or a lab class outside one) is worth flagging.
export const roomMismatch = (slot) =>
  (slot.session_type === 'lecture' && slot.room_type === 'Laboratory') ||
  (slot.session_type === 'lab' && slot.room_id && slot.room_type && slot.room_type !== 'Laboratory')

export default function RoomTypeBadge({ type, className = '' }) {
  const t = TYPES[type]
  if (!t) return null
  return (
    <span title={t.long} className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${t.cls} ${className}`}>
      {t.short}
    </span>
  )
}
