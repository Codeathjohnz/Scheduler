/**
 * Side-by-side layout for timetable blocks that overlap in time.
 *
 * Two classes on the same day can run at the same time (a shared gym runs
 * several PATHFIT sections together). Drawn at full width they sit on top of
 * each other, so neither can be read. Overlapping blocks are instead split into
 * columns: each block gets a column index and the number of columns its group
 * needs, and the page sets its left edge and width from those.
 *
 * Returns a Map from each slot to { col, cols }.
 */
const toMin = (t) => {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

export function laneLayout(slots) {
  const out = new Map()
  const items = slots
    .map(s => ({ s, start: toMin(s.start_time), end: toMin(s.end_time) }))
    .sort((a, b) => a.start - b.start || a.end - b.end)

  let group = []
  let groupEnd = -1
  const flush = () => {
    if (!group.length) return
    // Greedy column packing inside one cluster of overlapping blocks
    const colEnds = []
    for (const it of group) {
      let col = colEnds.findIndex(e => e <= it.start)
      if (col === -1) { col = colEnds.length; colEnds.push(it.end) } else { colEnds[col] = it.end }
      it.col = col
    }
    const cols = colEnds.length
    for (const it of group) out.set(it.s, { col: it.col, cols })
    group = []
  }

  for (const it of items) {
    if (group.length && it.start >= groupEnd) flush()
    group.push(it)
    groupEnd = Math.max(groupEnd, it.end)
  }
  flush()
  return out
}
