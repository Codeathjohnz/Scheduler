/**
 * Old-format prospectus PDF parser — OCR-based.
 *
 * Some departments' prospectus documents only exist as a SCANNED PDF (a
 * flat page image, no selectable text layer at all — confirmed by testing
 * against a real sample: pdfjs-dist's getTextContent() returns 0 items,
 * and the page's operator list is just one paintImageXObject). That rules
 * out any text-layer extraction approach (mammoth/pdf-text-parse); this
 * has to go through real OCR.
 *
 * Approach, validated against a real 2-page scanned prospectus:
 *   1. Pull the embedded page image straight out of the PDF (no canvas/
 *      native-binary rendering needed — the whole page IS one image).
 *   2. Detect the table's grid lines directly from pixel darkness:
 *      vertical lines -> column x-boundaries, horizontal lines -> row
 *      y-boundaries. Real ruled tables like this one hold a very precise,
 *      consistent grid, which is far more reliable than asking OCR to
 *      guess column boundaries from a whole crowded page (measured ~51%
 *      confidence and garbled codes/words on a whole-page OCR pass).
 *   3. Two-pass OCR per row:
 *      a. Classify the WHOLE row band in one OCR call (cheap) — is this
 *         a "FIRST YEAR" / "First Semester" header, the repeated column-
 *         header row, a "Total" row, or a real subject row?
 *      b. Only for real subject rows: re-OCR each of the 6 needed cells
 *         SEPARATELY (title, code, lec, lab, units, prerequisite —
 *         co-requisite is intentionally never read, nothing in this
 *         system consumes it). Isolating each cell is what actually gets
 *         accuracy up — measured perfect reads on titles/hours/units and
 *         only minor, fixable character confusions (l/1, |/1) on codes,
 *         versus a garbled mess when OCR has to read a whole row at once.
 *
 * OCR is never perfect on a scan, so this is deliberately conservative:
 * a row that doesn't look like a clean single row (see ANOMALY_HEIGHT_MULT
 * below) is never guessed at — it comes back as a flagged placeholder for
 * a human to fill in, rather than silently mis-reading several courses'
 * worth of hours/units into the database.
 */

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PNG } from 'pngjs'
import { createWorker } from 'tesseract.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// tesseract.js's WASM core already loads from node_modules locally in Node
// (its Node getCore.js always `require()`s tesseract.js-core — corePath is
// browser-only), but the English language data defaults to a CDN fetch
// (jsdelivr) unless told otherwise. Point it at the traineddata file
// already checked into this repo so OCR works with no outbound network
// call and no CDN as a production dependency.
const LANG_PATH = path.join(__dirname, '..')

const YEAR_WORDS = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4 }
const SEM_WORDS = { FIRST: 1, SECOND: 2, THIRD: 3, SUMMER: 3 }

// A row taller than this multiple of the page's typical row height almost
// certainly means the grid detector missed a faint/broken divider and
// merged two or more real rows into one band — never worth guessing at.
const ANOMALY_HEIGHT_MULT = 1.8

function isDark(png, x, y) {
  const i = (y * png.width + x) * 4
  return (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3 < 150
}

function groupAdjacent(sortedNums, maxGap) {
  if (!sortedNums.length) return []
  const groups = []
  let cur = [sortedNums[0]]
  for (let i = 1; i < sortedNums.length; i++) {
    if (sortedNums[i] - sortedNums[i - 1] <= maxGap) cur.push(sortedNums[i])
    else { groups.push(cur); cur = [sortedNums[i]] }
  }
  groups.push(cur)
  return groups.map(g => Math.round(g.reduce((a, b) => a + b, 0) / g.length))
}

// Vertical column dividers — scanned over a generous y-window (skips the
// letterhead/logo area up top and the signature block at the bottom).
// Uses LONGEST CONTIGUOUS dark run, not overall dark fraction: a page
// stacks several tables end-to-end, and a true column rule only needs to
// run the height of ONE of them to count — averaging darkness over the
// whole window instead (as a first version of this did) gets diluted by
// every other table's slightly different alignment and picks the wrong
// x's entirely. A run threshold of 300px (roughly one table block's
// height) reliably separates real rules from incidental text alignment,
// verified against a real 2-page scanned prospectus. x < 20 / > width-20
// is excluded — that's the page's own scan-edge artifact, not content.
function detectVerticalLines(png, y0, y1) {
  const cols = []
  for (let x = 20; x < png.width - 20; x++) {
    let best = 0, cur = 0
    for (let y = y0; y < y1; y++) {
      if (isDark(png, x, y)) { cur++; if (cur > best) best = cur }
      else cur = 0
    }
    if (best > 300) cols.push(x)
  }
  return groupAdjacent(cols, 3)
}

// Horizontal row dividers — scanned only within the table's own column
// span, over the full page height. Threshold is lower than it looks (0.75,
// not 0.85+) because real scans have faint/broken rule segments; 0.75 was
// the value that recovered a genuinely-present divider a stricter
// threshold missed, verified against the real sample.
function detectHorizontalLines(png, x0, x1, y0, y1) {
  const rows = []
  for (let y = y0; y < y1; y++) {
    let dark = 0, total = 0
    for (let x = x0; x < x1; x += 2) { total++; if (isDark(png, x, y)) dark++ }
    if (total > 0 && dark / total > 0.75) rows.push(y)
  }
  return groupAdjacent(rows, 3)
}

function cropCellPng(png, x0, y0, x1, y1, padX = 4, padY = 3) {
  x0 = Math.max(0, x0 + padX); y0 = Math.max(0, y0 + padY)
  x1 = Math.min(png.width, x1 - padX); y1 = Math.min(png.height, y1 - padY)
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
  const out = new PNG({ width: w, height: h })
  PNG.bitblt(png, out, x0, y0, w, h, 0, 0)
  return PNG.sync.write(out)
}

async function ocr(worker, buf, psm) {
  await worker.setParameters({ tessedit_pageseg_mode: psm })
  const { data } = await worker.recognize(buf)
  return data.text.trim().replace(/\s+/g, ' ')
}

// ── OCR cleanup ──────────────────────────────────────────────────────────

function cleanCourseCode(raw) {
  let s = raw.trim().replace(/^[|{}[\]"'`~!]+|[|{}[\]"'`~!]+$/g, '').trim()
  // The trailing numeric part of a code (e.g. "GE 0l" -> "GE 01", "NSTP |"
  // -> "NSTP 1") is where OCR's letter/digit confusion actually matters —
  // the alphabetic prefix (GE, Math, PATHFit, Prof. Ed, ...) OCRs cleanly.
  const m = s.match(/^([A-Za-z.\s]+?)\s*([0-9lLIiO|.\s&]*)$/)
  if (m && m[2] && m[2].trim()) {
    const fixedSuffix = m[2].replace(/[lI|]/g, '1').replace(/O/g, '0').trim()
    s = `${m[1].trim()} ${fixedSuffix}`.trim()
  }
  return s.replace(/\s+/g, ' ')
}

function cleanNumber(raw) {
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? 0 : n
}

function cleanPrereq(raw) {
  const s = raw.trim().replace(/^[|{}[\]"'`~!]+|[|{}[\]"'`~!]+$/g, '').trim()
  if (!s || /^none$/i.test(s)) return null
  return s
}

function classifyBand(text) {
  const t = text.trim()
  let m
  if ((m = t.match(/(FIRST|SECOND|THIRD|FOURTH)\s+YEAR/i))) {
    return { type: 'year', value: YEAR_WORDS[m[1].toUpperCase()] }
  }
  if ((m = t.match(/(FIRST|SECOND|THIRD|SUMMER)\s+SEMESTER/i))) {
    return { type: 'semester', value: SEM_WORDS[m[1].toUpperCase()] }
  }
  if (/descriptive\s*title/i.test(t) || /course\s*number/i.test(t)) return { type: 'header' }
  if (/^\W{0,3}total\b/i.test(t)) return { type: 'total' }
  if (/program\s+of\s+study/i.test(t)) return { type: 'title' }
  if (t.replace(/\W/g, '').length < 2) return { type: 'empty' }
  return { type: 'data' }
}

// ── embedded page image extraction (the page IS one scanned image) ──────

async function extractPageImage(page) {
  const ops = await page.getOperatorList()
  const idx = ops.fnArray.indexOf(OPS.paintImageXObject)
  if (idx === -1) return null
  const imgName = ops.argsArray[idx][0]
  const img = await new Promise(resolve => page.objs.get(imgName, resolve))
  if (!img?.width || !img?.height) return null

  const png = new PNG({ width: img.width, height: img.height })
  const src = img.data
  if (img.kind === 2) { // RGB, 3 bytes/px
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      png.data[j] = src[i]; png.data[j + 1] = src[i + 1]; png.data[j + 2] = src[i + 2]; png.data[j + 3] = 255
    }
  } else if (img.kind === 1) { // Grayscale, 1 byte/px
    for (let i = 0, j = 0; i < src.length; i++, j += 4) {
      png.data[j] = src[i]; png.data[j + 1] = src[i]; png.data[j + 2] = src[i]; png.data[j + 3] = 255
    }
  } else {
    return null // CMYK/indexed etc. — not handled, caller reports a clear error
  }
  return png
}

// ── per-page table extraction ─────────────────────────────────────────────

async function parsePageTable(png, worker, state) {
  const subjects = []
  const vLines = detectVerticalLines(png, 200, png.height - 80)
  if (vLines.length < 7) {
    throw new Error('Could not detect a clear table grid on one of the pages (found too few column lines). The scan may be too faint, skewed, or laid out differently than expected.')
  }
  const tableX0 = vLines[0], tableX1 = vLines[vLines.length - 1]
  const colCount = vLines.length - 1 // 6 (no co-requisite col) or 7

  const hLines = detectHorizontalLines(png, tableX0, tableX1, 200, png.height - 60)
  const gaps = []
  for (let i = 0; i < hLines.length - 1; i++) gaps.push(hLines[i + 1] - hLines[i])
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const typicalRowHeight = sortedGaps[Math.floor(sortedGaps.length / 2)] || 28

  for (let i = 0; i < hLines.length - 1; i++) {
    const y0 = hLines[i], y1 = hLines[i + 1]
    const height = y1 - y0
    const bandBuf = cropCellPng(png, tableX0, y0, tableX1, y1)
    const bandText = await ocr(worker, bandBuf, '6')
    const cls = classifyBand(bandText)

    if (cls.type === 'year') { state.yearLevel = cls.value; continue }
    if (cls.type === 'semester') { state.semester = cls.value; continue }
    if (cls.type === 'header' || cls.type === 'total' || cls.type === 'title' || cls.type === 'empty') continue

    // A row much taller than typical means the grid detector likely
    // merged 2+ real rows together — never guess, flag for manual entry.
    if (height > typicalRowHeight * ANOMALY_HEIGHT_MULT) {
      subjects.push({
        course_code: '⚠ REVIEW',
        descriptive_title: `Could not confidently read this row — please add it manually. OCR saw: "${bandText}"`,
        units: 0, lec_hours: 0, lab_hours: 0,
        year_level: state.yearLevel, semester: state.semester,
        prerequisite: null,
        needsReview: true,
      })
      continue
    }

    const title = await ocr(worker, cropCellPng(png, vLines[0], y0, vLines[1], y1), '6')
    const code = await ocr(worker, cropCellPng(png, vLines[1], y0, vLines[2], y1), '7')
    // Lec/Lab/Units columns are narrow (~55-65px) — the default padding
    // (tuned for the wide text columns, to stay clear of divider-line
    // bleed) crops right into the digit itself on these, sometimes
    // yielding empty OCR output entirely. A slimmer pad fixes that,
    // verified against the real sample (padding 4/3 -> "", padding 1/1
    // -> "3" on an otherwise-identical crop).
    const lec = await ocr(worker, cropCellPng(png, vLines[2], y0, vLines[3], y1, 1, 1), '8')
    const lab = await ocr(worker, cropCellPng(png, vLines[3], y0, vLines[4], y1, 1, 1), '8')
    const units = await ocr(worker, cropCellPng(png, vLines[4], y0, vLines[5], y1, 1, 1), '8')
    const prereq = colCount >= 6 ? await ocr(worker, cropCellPng(png, vLines[5], y0, vLines[6], y1), '6') : ''

    const cleanTitle = title.trim()
    const cleanCode = cleanCourseCode(code)
    if (!cleanTitle && !cleanCode) continue // a genuinely blank band (spacer row) — nothing to add

    subjects.push({
      course_code: cleanCode || '⚠ REVIEW',
      descriptive_title: cleanTitle || `Could not read the course code for "${cleanTitle}" — please fill it in manually.`,
      units: cleanNumber(units),
      lec_hours: cleanNumber(lec),
      lab_hours: cleanNumber(lab),
      year_level: state.yearLevel,
      semester: state.semester,
      prerequisite: cleanPrereq(prereq),
      needsReview: !cleanTitle || !cleanCode,
    })
  }
  return subjects
}

/**
 * @param {Buffer} buffer - raw PDF file bytes
 * @returns {Promise<object[]>} subjects in the same shape the Excel/Word
 *   parsers produce (course_code, descriptive_title, units, lec_hours,
 *   lab_hours, year_level, semester, prerequisite), plus a `needsReview`
 *   flag on any row OCR couldn't confidently read.
 */
export async function parseProspectusPdf(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise
  const state = { yearLevel: 1, semester: 1 }
  const allSubjects = []
  const worker = await createWorker('eng', 1, { langPath: LANG_PATH, gzip: false })
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const textContent = await page.getTextContent()
      if (textContent.items.length > 5) {
        throw new Error('This PDF has real selectable text (it\'s not a scan) — please use the Excel or Word upload instead, it will read far more accurately.')
      }
      const png = await extractPageImage(page)
      if (!png) {
        throw new Error(`Page ${p} doesn't look like a single scanned table image this parser understands. Try the Excel or Word upload instead.`)
      }
      allSubjects.push(...await parsePageTable(png, worker, state))
    }
  } finally {
    await worker.terminate()
  }
  if (!allSubjects.length) {
    throw new Error('No subjects could be read from this PDF. It may be too faint or skewed for OCR — try the Excel or Word upload instead.')
  }
  return allSubjects
}
