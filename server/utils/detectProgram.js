/**
 * Reads which program a prospectus is FOR, from the document itself.
 *
 * A prospectus can mention other programs in its body (shared GE courses,
 * a sister program's name in a footer), so raw frequency alone is unreliable.
 * Evidence is weighted by where it appears:
 *   - the file name            (strongest: how the chair saved it)
 *   - the title/header area    (the first part of the document)
 *   - a program code anywhere  (weakest: body mentions, counted)
 * Returns null when nothing recognizable is found; the caller then has to ask.
 */
const TITLE_PHRASES = [
  ['ELECTRONICS ENGINEERING', 'BSECE'],
  ['CIVIL ENGINEERING', 'BSCE'],
  ['COMPUTER ENGINEERING', 'BSCPE'],
  ['INFORMATION SYSTEMS', 'BSIS'],
  ['INFORMATION TECHNOLOGY', 'BSIT'],
  ['COMPUTER SCIENCE', 'BSCS'],
]
const HEAD_CHARS = 1500
const BODY_CAP = 20
// A code may carry a suffix after a hyphen ("BSED-MATH"), read as one program.
const CODE_RE = /\bBS[A-Za-z]{1,8}(?:-[A-Za-z]{2,8})?\b/g

// Two program names are the same program when they match ignoring case and
// punctuation: "BSED-MATH", "BSED MATH" and "bsedmath" all name one program.
export function programKey(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
export function sameProgram(a, b) {
  const ka = programKey(a)
  return !!ka && ka === programKey(b)
}

// Whole-word containment on normalized text: "ABEL" is in "ABEL.docx" and
// "BSED-MATH" is in "BSED MATH Prospectus", but "ABEL" is not in "CABELLA".
const wordsOf = (s) => ' ' + String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() + ' '
const names = (text, tag) => wordsOf(text).includes(wordsOf(tag))

// `known` is the chair's own program tag(s). Their names count as strong
// evidence even when they aren't BS-coded, e.g. a chair tagged "ABEL".
export function detectProspectusProgram(text, filename = '', known = []) {
  const knownTags = (known || []).map(t => String(t || '').trim()).filter(Boolean)
  const str = String(text || '')
  const head = str.slice(0, HEAD_CHARS).toUpperCase()
  const name = String(filename || '').toUpperCase()
  const score = new Map()   // programKey -> points
  const shown = new Map()   // programKey -> how the file wrote it
  const add = (code, points) => {
    const k = programKey(code)
    if (!shown.has(k)) shown.set(k, code)
    score.set(k, (score.get(k) || 0) + points)
  }

  // File name: a code spelled out in it ("BSECE Prospectus.docx"), or one of
  // the chair's own program names.
  for (const tag of knownTags) if (names(name, tag)) add(tag, 100)
  for (const m of name.matchAll(CODE_RE)) add(m[0], 100)
  for (const [phrase, code] of TITLE_PHRASES) if (name.includes(phrase)) add(code, 100)

  // Header/title area: a code or program title near the top of the document.
  for (const tag of knownTags) if (names(head, tag)) add(tag, 60)
  for (const code of new Set([...head.matchAll(CODE_RE)].map(m => m[0]))) add(code, 30)
  for (const [phrase, code] of TITLE_PHRASES) if (head.includes(phrase)) add(code, 100)

  // Body: every mention counts a little, so a long document that names its
  // own program repeatedly still beats a single stray mention elsewhere.
  // Capped, so a long body that repeats some other program can't outweigh a
  // title or file name that says what this document is.
  const bodyCounts = new Map()
  for (const m of str.toUpperCase().matchAll(CODE_RE)) bodyCounts.set(m[0], (bodyCounts.get(m[0]) || 0) + 1)
  for (const [code, n] of bodyCounts) add(code, Math.min(n, BODY_CAP))

  if (!score.size) return null
  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return shown.get(best)
}
