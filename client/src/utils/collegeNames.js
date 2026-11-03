// Official full college names, keyed by department code. A code with no
// entry here falls back to the code itself — safer than guessing an
// official name wrong on a document meant to look formal.
export const COLLEGE_NAMES = {
  CCIS: 'COLLEGE OF COMPUTING AND INFORMATION SCIENCES',
  CTE:  'COLLEGE OF TEACHER EDUCATION',
}

export function collegeFullName(deptCode) {
  const code = String(deptCode || '').trim().toUpperCase()
  return COLLEGE_NAMES[code] || code || 'UNKNOWN COLLEGE'
}

// Extract the leading program code from a free-typed "program_yr_sec"
// string (e.g. "BSIT 1A" -> "BSIT", "BSIS-2B" -> "BSIS").
export function programCodeOf(programYrSec) {
  const m = String(programYrSec || '').trim().match(/^([A-Za-z]+)/)
  return m ? m[1].toUpperCase() : null
}

// Every distinct program code present across a set of entries, in the
// order first seen — used for a header that can't assume just one program
// (a college chair's load can span more than one, e.g. CCIS runs both
// BSIT and BSIS).
export function programCodesOf(entries) {
  const codes = []
  for (const e of entries) {
    const code = programCodeOf(e.program_yr_sec)
    if (code && !codes.includes(code)) codes.push(code)
  }
  return codes
}
