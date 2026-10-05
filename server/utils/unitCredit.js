/**
 * Unit credit a subject adds to a load (the figure the 21/27 cap is on).
 *
 * Normally that's Lec + Lab×0.75 (lab hours are weekly contact hours). An
 * internship, practicum, or on-the-job training subject is different: its
 * "hours" are the total training hours (e.g. 450), not a weekly lab, so it
 * counts its units instead. Without this, a 3-unit internship with 450 lab hours
 * becomes 337.5 credit and the instructor looks wildly overloaded.
 */
const INTERNSHIP = /\b(intern|internship|practicum|on[- ]?the[- ]?job|ojt)\b/i

export function creditOf(e) {
  if (INTERNSHIP.test(String(e?.descriptive_title || ''))) return Number(e?.units || 0)
  return Number(e?.lec_hours || 0) + Number(e?.lab_hours || 0) * 0.75
}
