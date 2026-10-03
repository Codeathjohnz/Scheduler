/**
 * Reads which program a prospectus is FOR, from the document's own text.
 *
 * Prospectuses name their program in the body (e.g. "BSIT" or "BSECE"), so
 * that's the signal used first — the most frequently named BS code wins,
 * earliest mention breaking ties. A document that never spells a code out
 * falls back to its program title in the first part of the text. Returns
 * null when nothing recognizable is found; the caller then has to ask.
 */
const TITLE_PHRASES = [
  ['ELECTRONICS ENGINEERING', 'BSECE'],
  ['CIVIL ENGINEERING', 'BSCE'],
  ['COMPUTER ENGINEERING', 'BSCPE'],
  ['INFORMATION SYSTEMS', 'BSIS'],
  ['INFORMATION TECHNOLOGY', 'BSIT'],
  ['COMPUTER SCIENCE', 'BSCS'],
]

export function detectProspectusProgram(text) {
  const str = String(text || '')
  const counts = new Map()
  const firstAt = new Map()
  const re = /\bBS[A-Za-z]{1,8}\b/g
  let m
  while ((m = re.exec(str))) {
    const code = m[0].toUpperCase()
    counts.set(code, (counts.get(code) || 0) + 1)
    if (!firstAt.has(code)) firstAt.set(code, m.index)
  }
  if (counts.size) {
    return [...counts.keys()].sort((a, b) =>
      counts.get(b) - counts.get(a) || firstAt.get(a) - firstAt.get(b)
    )[0]
  }
  const head = str.slice(0, 1500).toUpperCase()
  for (const [phrase, code] of TITLE_PHRASES) {
    if (head.includes(phrase)) return code
  }
  return null
}
