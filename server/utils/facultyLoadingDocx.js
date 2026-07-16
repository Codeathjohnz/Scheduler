import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import pool from '../config/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'faculty-loading-template.docx')

// Same formula used everywhere else in this codebase (facultyload.js,
// client/src/pages/chair/FacultyLoad.jsx): Contact Hours = Lec + Lab,
// Unit Credit = Lec + Lab×0.75 — confirmed against the real Faculty Loading
// form and the official Prospectus's own Lec/Lab/Units figures.
function contactHours(lec, lab) {
  return Number(lec || 0) + Number(lab || 0)
}
function unitCredit(lec, lab) {
  return Number(lec || 0) + Number(lab || 0) * 0.75
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// docxtemplater needs '' (not 0) for a section total when that section has
// zero entries, matching the original form's blank-when-empty convention.
function fmtTotal(n, hasEntries) {
  return hasEntries ? round2(n) : ''
}

// ── e-signature embedding ─────────────────────────────────────────────────
//
// docxtemplater has no built-in image support, and the community image
// module (docxtemplater-image-module-free) pulls in an unmaintained xmldom
// with several unpatched critical CVEs — not worth it for embedding one
// small PNG. Since this project already fully controls the template's XML
// (see the build script that produced faculty-loading-template.docx), the
// simpler and safer route is: render the text normally with docxtemplater,
// then manually splice a real <w:drawing> into the rendered zip wherever a
// unique marker string was rendered in place of {deanSignatureMarker} /
// {vpaaSignatureMarker}. A marker only ever gets rendered when a real
// signature is available (see buildInstructorData below), so an
// unconfirmed submission leaves that cell blank exactly as before.

function pngDimensions(buf) {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Not a valid PNG (missing IHDR chunk).')
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// Target a fixed physical height so the signature reads consistently
// regardless of the uploaded image's resolution; cap width so an unusually
// wide signature can't overflow its table cell. Two sizes: the full
// signature on the last-page block, and a smaller one for the per-page
// footer's compact "Initial" cell (~1.7in wide).
const SIGNATURE_SIZES = {
  full:   { heightEmu: 320040, maxWidthEmu: 2200000 },   // 0.35in tall, ~2.4in cap
  footer: { heightEmu: 160020, maxWidthEmu: 1300000 },   // 0.175in tall, ~1.4in cap
}

function signatureEmuSize(pxWidth, pxHeight, size = 'full') {
  const { heightEmu, maxWidthEmu } = SIGNATURE_SIZES[size]
  let cy = heightEmu
  let cx = Math.round(cy * (pxWidth / pxHeight))
  if (cx > maxWidthEmu) {
    cx = maxWidthEmu
    cy = Math.round(cx * (pxHeight / pxWidth))
  }
  return { cx, cy }
}

function drawingXml({ rId, docPrId, cx, cy }) {
  return (
    `<w:r><w:drawing>` +
    `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="Signature${docPrId}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Signature${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  )
}

// Splices one signature image into `zip` (a rendered docxtemplater PizZip)
// wherever `markerValue` appears as a lone run's text in `targetXmlPath` —
// added as a new media file + relationship in that part's OWN _rels file
// (each OOXML part — document.xml, footer2.xml, etc. — has its own
// independent relationship namespace; a footer's r:id is meaningless in
// document.xml.rels and vice versa). Creates the rels file fresh if the
// part didn't already have one (footer2.xml has none in the source template).
function embedSignatureImage(zip, {
  markerValue, pngDataUri, rId, mediaFilename, docPrId, targetXmlPath, relsPath, size = 'full',
}) {
  const base64 = pngDataUri.replace(/^data:image\/png;base64,/, '')
  const buf = Buffer.from(base64, 'base64')
  const { width, height } = pngDimensions(buf)
  const { cx, cy } = signatureEmuSize(width, height, size)

  zip.file(`word/media/${mediaFilename}`, buf, { binary: true })

  const existingRelsFile = zip.file(relsPath)
  const relsXml = existingRelsFile
    ? existingRelsFile.asText()
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  const newRel = `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaFilename}"/>`
  zip.file(relsPath, relsXml.replace('</Relationships>', `${newRel}</Relationships>`))

  const targetXml = zip.file(targetXmlPath).asText()
  // docxtemplater renders a plain-string tag substitution as
  // <w:t xml:space="preserve">value</w:t> (it always adds xml:space, even
  // without leading/trailing whitespace), not the bare <w:t> the template
  // source had before rendering. The run itself may or may not carry a
  // <w:rPr> before that <w:t> depending on the source cell (the footer's
  // Initial cell has one for font size; the document.xml course row
  // doesn't) — match either shape rather than assuming one.
  const escaped = markerValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const markerRunPattern = new RegExp(`<w:r>(?:(?!</w:r>)[\\s\\S])*?<w:t xml:space="preserve">${escaped}</w:t></w:r>`)
  const match = markerRunPattern.exec(targetXml)
  if (!match) {
    throw new Error(`Signature marker ${markerValue} not found in rendered ${targetXmlPath} — template may be out of sync.`)
  }
  zip.file(targetXmlPath, targetXml.replace(markerRunPattern, drawingXml({ rId, docPrId, cx, cy })))
}

export async function generateFacultyLoadingDocx({ chairId, academicYear, semester, collegeName, programName }) {
  const [chairRows] = await pool.query('SELECT name, department FROM users WHERE id = ?', [chairId])
  const chair = chairRows[0]
  if (!chair) throw new Error('Chair not found.')

  // Dean confirmation is scoped by department (one dean per college); Chief
  // CPD and VPAA endorsement are university-wide (one account each). A
  // signature is only ever attached once that specific person's approval is
  // CURRENTLY in effect for this term's submission.
  //
  // dean_action_at/chief_cpd_action_at/vpaa_action_at are NOT reliable
  // "confirmed" signals on their own — /:id/dean, /:id/chief-cpd, and
  // /:id/vpaa in submissions.js stamp that same timestamp on a REJECTION
  // too (action !== 'confirm'/'endorse' just sets status to 'returned' with
  // the same NOW()). The only trustworthy signal is the submission's
  // current status: it only reads as one of the stages past a given role if
  // that stage actually passed, not if it got returned there or anywhere
  // upstream — a 'returned' submission gets no signatures at all, since its
  // approval chain is currently broken regardless of which stage sent it back.
  const [[submission]] = await pool.query(
    `SELECT status, dean_action_at, chief_cpd_action_at FROM submissions
     WHERE chair_id = ? AND academic_year = ? AND semester = ?
     ORDER BY created_at DESC LIMIT 1`,
    [chairId, academicYear, semester]
  )
  const PAST_DEAN = new Set(['pending_chief_cpd', 'pending_qa', 'pending_vpaa', 'pending_admin', 'validated', 'scheduled'])
  // "Reviewed by" on the form is Chief Curriculum Planning and Development —
  // a distinct role from Quality Assurance (confirmed with the user), sitting
  // between Dean and QA in the approval chain: chair -> dean -> chief_cpd ->
  // quality_assurance -> vpaa -> admin. QA itself has no signature line on
  // this form (the VPAA's own title already reads "...and Quality
  // Assurance"), so it isn't queried here at all.
  const PAST_CHIEF_CPD = new Set(['pending_qa', 'pending_vpaa', 'pending_admin', 'validated', 'scheduled'])
  const PAST_VPAA = new Set(['pending_admin', 'validated', 'scheduled'])
  let dean = null, reviewer = null, vpaa = null
  if (submission && PAST_DEAN.has(submission.status)) {
    const [[row]] = await pool.query(
      "SELECT name, signature_image FROM users WHERE role = 'dean' AND department = ? LIMIT 1",
      [chair.department]
    )
    dean = row || null
  }
  if (submission && PAST_CHIEF_CPD.has(submission.status)) {
    const [[row]] = await pool.query("SELECT name, signature_image FROM users WHERE role = 'chief_cpd' LIMIT 1")
    reviewer = row || null
  }
  if (submission && PAST_VPAA.has(submission.status)) {
    const [[row]] = await pool.query("SELECT name, signature_image FROM users WHERE role = 'vpaa' LIMIT 1")
    vpaa = row || null
  }
  const deanSignatureMarker = dean?.signature_image ? 'SIGNATURE_MARKER_DEAN' : ''
  const reviewerSignatureMarker = reviewer?.signature_image ? 'SIGNATURE_MARKER_REVIEWER' : ''
  const vpaaSignatureMarker = vpaa?.signature_image ? 'SIGNATURE_MARKER_VPAA' : ''

  // Per-page footer: PC's, Dean's, and Chief CPD's Initial + Date. PC's
  // initial always shows — the chair is the one generating this report
  // right now — dated today; Dean's and Chief CPD's only show once
  // genuinely confirmed (see `dean`/`reviewer` above), using the signature
  // image if uploaded or plain text initials as a fallback, dated from
  // their actual confirm action.
  const initialsOf = (name) => (name || '').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + '.').join('')
  const formatDate = (d) => {
    const dt = new Date(d)
    return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`
  }
  const chairInitial = initialsOf(chair.name)
  const chairDateDisplay = formatDate(new Date())
  const deanFooterSignatureMarker = dean?.signature_image ? 'SIGNATURE_MARKER_DEAN_FOOTER' : ''
  const deanInitialDisplay = dean ? (deanFooterSignatureMarker || initialsOf(dean.name)) : ''
  const deanDateDisplay = dean && submission?.dean_action_at ? formatDate(submission.dean_action_at) : '/         /'
  const reviewerFooterSignatureMarker = reviewer?.signature_image ? 'SIGNATURE_MARKER_REVIEWER_FOOTER' : ''
  const reviewerInitialDisplay = reviewer ? (reviewerFooterSignatureMarker || initialsOf(reviewer.name)) : ''
  const reviewerDateDisplay = reviewer && submission?.chief_cpd_action_at ? formatDate(submission.chief_cpd_action_at) : '/         /'

  const [entries] = await pool.query(`
    SELECT fle.*, u.id AS instructor_id, u.name AS instructor_name
    FROM faculty_load_entries fle
    JOIN users u ON fle.assigned_instructor_id = u.id
    WHERE fle.chair_id = ? AND fle.academic_year = ? AND fle.semester = ?
    ORDER BY u.name, fle.sort_order, fle.id
  `, [chairId, academicYear, semester])

  const [adminLoadRows] = await pool.query(`
    SELECT fal.*, u.name AS instructor_name
    FROM faculty_admin_loads fal
    JOIN users u ON fal.instructor_id = u.id
    WHERE fal.chair_id = ? AND fal.academic_year = ? AND fal.semester = ?
  `, [chairId, academicYear, semester])

  // Group by instructor — only instructors with at least one teaching entry
  // or admin/research load appear in the report.
  const byInstructor = new Map()
  const order = []
  function ensure(id, name) {
    if (!byInstructor.has(id)) {
      byInstructor.set(id, { name, courses: [], adminLoads: [], researchLoads: [] })
      order.push(id)
    }
    return byInstructor.get(id)
  }

  for (const e of entries) {
    const inst = ensure(e.instructor_id, e.instructor_name)
    inst.courses.push({
      courseNo: e.course_code,
      title: e.descriptive_title,
      program: e.program_yr_sec || '',
      units: e.units,
      lec: e.lec_hours,
      lab: e.lab_hours,
      unitCredit: round2(unitCredit(e.lec_hours, e.lab_hours)),
      contactHours: contactHours(e.lec_hours, e.lab_hours),
      labRoom: e.room || '',
    })
  }

  for (const a of adminLoadRows) {
    const inst = ensure(a.instructor_id, a.instructor_name)
    const row = {
      desc: a.description,
      units: a.units,
      lec: a.lec_hours || 0,
      lab: a.lab_hours || 0,
      unitCredit: round2(unitCredit(a.lec_hours, a.lab_hours) || Number(a.units)),
      contactHours: contactHours(a.lec_hours, a.lab_hours) || Number(a.units),
    }
    if (a.load_type === 'administrative') inst.adminLoads.push(row)
    else inst.researchLoads.push(row)
  }

  const instructors = order.map(id => {
    const inst = byInstructor.get(id)

    const sum = (list, key) => list.reduce((acc, r) => acc + Number(r[key] || 0), 0)

    const totalUnits        = sum(inst.courses, 'units')
    const totalLec           = sum(inst.courses, 'lec')
    const totalLab           = sum(inst.courses, 'lab')
    const totalUnitCredit    = round2(sum(inst.courses, 'unitCredit'))
    const totalContactHours  = sum(inst.courses, 'contactHours')

    const hasAdmin = inst.adminLoads.length > 0
    const totalAdminUnits       = sum(inst.adminLoads, 'units')
    const totalAdminLec         = sum(inst.adminLoads, 'lec')
    const totalAdminLab         = sum(inst.adminLoads, 'lab')
    const totalAdminUnitCredit  = round2(sum(inst.adminLoads, 'unitCredit'))
    const totalAdminContactHours = sum(inst.adminLoads, 'contactHours')

    const hasResearch = inst.researchLoads.length > 0
    const totalResearchUnits       = sum(inst.researchLoads, 'units')
    const totalResearchLec         = sum(inst.researchLoads, 'lec')
    const totalResearchLab         = sum(inst.researchLoads, 'lab')
    const totalResearchUnitCredit  = round2(sum(inst.researchLoads, 'unitCredit'))
    const totalResearchContactHours = sum(inst.researchLoads, 'contactHours')

    return {
      collegeName: collegeName || chair.department || '',
      programName: programName || '',
      semester: ['', '1st', '2nd', 'Summer'][semester] || String(semester),
      academicYear,
      name: inst.name,
      courses: inst.courses.map(c => ({
        ...c,
        unitCredit: c.unitCredit.toFixed(2).replace(/\.00$/, ''),
      })),
      totalUnits, totalLec, totalLab,
      totalUnitCredit: totalUnitCredit.toFixed(2).replace(/\.00$/, ''),
      totalContactHours,
      adminLoads: inst.adminLoads.map(r => ({
        adminDesc: r.desc, adminUnits: r.units, adminLec: r.lec, adminLab: r.lab,
        adminUnitCredit: r.unitCredit, adminContactHours: r.contactHours,
      })),
      totalAdminUnits: fmtTotal(totalAdminUnits, hasAdmin),
      totalAdminLec: fmtTotal(totalAdminLec, hasAdmin),
      totalAdminLab: fmtTotal(totalAdminLab, hasAdmin),
      totalAdminUnitCredit: fmtTotal(totalAdminUnitCredit, hasAdmin),
      totalAdminContactHours: fmtTotal(totalAdminContactHours, hasAdmin),
      researchLoads: inst.researchLoads.map(r => ({
        researchDesc: r.desc, researchUnits: r.units, researchLec: r.lec, researchLab: r.lab,
        researchUnitCredit: r.unitCredit, researchContactHours: r.contactHours,
      })),
      totalResearchUnits: fmtTotal(totalResearchUnits, hasResearch),
      totalResearchLec: fmtTotal(totalResearchLec, hasResearch),
      totalResearchLab: fmtTotal(totalResearchLab, hasResearch),
      totalResearchUnitCredit: fmtTotal(totalResearchUnitCredit, hasResearch),
      totalResearchContactHours: fmtTotal(totalResearchContactHours, hasResearch),
      grandTotalUnits: totalUnits + totalAdminUnits + totalResearchUnits,
      grandTotalLec: totalLec + totalAdminLec + totalResearchLec,
      grandTotalLab: totalLab + totalAdminLab + totalResearchLab,
      grandTotalUnitCredit: round2(totalUnitCredit + totalAdminUnitCredit + totalResearchUnitCredit).toFixed(2).replace(/\.00$/, ''),
      grandTotalContactHours: totalContactHours + totalAdminContactHours + totalResearchContactHours,
    }
  })

  if (instructors.length === 0) {
    throw new Error('No faculty load entries with an assigned instructor found for this term.')
  }

  const templateBuf = fs.readFileSync(TEMPLATE_PATH)
  const zip = new PizZip(templateBuf)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })

  doc.render({
    chairName: chair.name,
    instructors,
    deanName: dean?.name || '',
    reviewerName: reviewer?.name || '',
    vpaaName: vpaa?.name || '',
    deanSignatureMarker,
    reviewerSignatureMarker,
    vpaaSignatureMarker,
    chairInitial,
    deanInitialDisplay,
    reviewerInitialDisplay,
    chairDateDisplay,
    deanDateDisplay,
    reviewerDateDisplay,
  })

  const renderedZip = doc.getZip()
  if (dean?.signature_image) {
    embedSignatureImage(renderedZip, {
      markerValue: deanSignatureMarker, pngDataUri: dean.signature_image,
      rId: 'rIdSigDean', mediaFilename: 'signature_dean.png', docPrId: 9001,
      targetXmlPath: 'word/document.xml', relsPath: 'word/_rels/document.xml.rels',
    })
  }
  if (reviewer?.signature_image) {
    embedSignatureImage(renderedZip, {
      markerValue: reviewerSignatureMarker, pngDataUri: reviewer.signature_image,
      rId: 'rIdSigReviewer', mediaFilename: 'signature_reviewer.png', docPrId: 9004,
      targetXmlPath: 'word/document.xml', relsPath: 'word/_rels/document.xml.rels',
    })
  }
  if (vpaa?.signature_image) {
    embedSignatureImage(renderedZip, {
      markerValue: vpaaSignatureMarker, pngDataUri: vpaa.signature_image,
      rId: 'rIdSigVpaa', mediaFilename: 'signature_vpaa.png', docPrId: 9002,
      targetXmlPath: 'word/document.xml', relsPath: 'word/_rels/document.xml.rels',
    })
  }
  if (dean?.signature_image && deanFooterSignatureMarker) {
    embedSignatureImage(renderedZip, {
      markerValue: deanFooterSignatureMarker, pngDataUri: dean.signature_image,
      rId: 'rIdSigDeanFooter', mediaFilename: 'signature_dean_footer.png', docPrId: 9003,
      targetXmlPath: 'word/footer2.xml', relsPath: 'word/_rels/footer2.xml.rels', size: 'footer',
    })
  }
  if (reviewer?.signature_image && reviewerFooterSignatureMarker) {
    embedSignatureImage(renderedZip, {
      markerValue: reviewerFooterSignatureMarker, pngDataUri: reviewer.signature_image,
      rId: 'rIdSigReviewerFooter', mediaFilename: 'signature_reviewer_footer.png', docPrId: 9005,
      targetXmlPath: 'word/footer2.xml', relsPath: 'word/_rels/footer2.xml.rels', size: 'footer',
    })
  }

  return renderedZip.generate({ type: 'nodebuffer' })
}
