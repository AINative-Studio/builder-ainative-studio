/**
 * PPTX serializer for the pitch deck (#69) — turns a pure DeckModel
 * (lib/build/deck-model.ts) into a real, editable Microsoft PowerPoint file
 * (Open XML / .pptx) with NO new dependency: we assemble the minimal-but-valid
 * OOXML package with `jszip`, which is already a declared dependency of this repo.
 *
 * WHY OOXML-by-hand: the deliverable must be a downloadable, EDITABLE deck a
 * founder can open in PowerPoint/Keynote/Google Slides and tweak before pitching.
 * A .pptx is a ZIP of XML parts; we emit exactly the parts a conformant reader
 * needs (content types, package + presentation rels, presentation.xml, one
 * slideLayout + slideMaster, and one slide per DeckSlide), themed with the
 * company brand color. The XML here is deliberately small and well-formed.
 *
 * The heavy/model side (what goes on each slide) lives in deck-model.ts and is
 * fully unit-tested; this file is the serialization seam and is exercised by the
 * route + integration test (which mock the model generation).
 */

import JSZip from 'jszip'
import type { DeckModel, DeckSlide } from '@/lib/build/deck-model'
import { SECTION_HEADINGS, normalizeDeckColor } from '@/lib/build/deck-model'

/** EMU per inch (Open XML uses English Metric Units). 16:9 slide = 12192000 x 6858000. */
const SLIDE_W = 12192000
const SLIDE_H = 6858000

/** Escape a string for safe inclusion in XML text/attribute content. */
export function xmlEscape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** #RRGGBB → RRGGBB (no hash), for OOXML srgbClr val="". */
function hex(color?: string): string {
  return normalizeDeckColor(color).replace('#', '')
}

/** A single text-body paragraph run (title/heading/bullet). */
function para(text: string, opts: { size: number; color?: string; bold?: boolean; bullet?: boolean }): string {
  const props =
    `<a:pPr${opts.bullet ? '' : ' marL="0" indent="0"'}>` +
    (opts.bullet ? '' : '<a:buNone/>') +
    '</a:pPr>'
  const run =
    `<a:r><a:rPr lang="en-US" sz="${opts.size}"${opts.bold ? ' b="1"' : ''}>` +
    (opts.color ? `<a:solidFill><a:srgbClr val="${hex(opts.color)}"/></a:solidFill>` : '') +
    `</a:rPr><a:t>${xmlEscape(text)}</a:t></a:r>`
  return `<a:p>${props}${run}</a:p>`
}

/** Build the slide XML for one DeckSlide, themed with the brand color. */
export function slideXml(slide: DeckSlide, brandColor: string): string {
  const isCover = slide.section === 'title'
  const accent = hex(brandColor)

  // Cover: big brand name centered on a brand-color band; content: heading + bullets.
  const shapes: string[] = []

  if (isCover) {
    // Full-bleed brand band.
    shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="cover-bg"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W}" cy="${SLIDE_H}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
        `<a:solidFill><a:srgbClr val="${accent}"/></a:solidFill></p:spPr>` +
        `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`,
    )
    const title = para(slide.heading, { size: 4400, color: 'FFFFFF', bold: true })
    const sub = slide.subheading ? para(slide.subheading, { size: 2000, color: 'FFFFFF' }) : ''
    shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="cover-title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="838200" y="2743200"/><a:ext cx="10515600" cy="2000000"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${title}${sub}</p:txBody></p:sp>`,
    )
  } else {
    // Heading bar.
    const heading = para(SECTION_HEADINGS[slide.section], { size: 3200, color: brandColor.replace('#', ''), bold: true })
    shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="heading"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="10820400" cy="838200"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
        `<p:txBody><a:bodyPr/><a:lstStyle/>${heading}</p:txBody></p:sp>`,
    )
    const bodyParas: string[] = []
    if (slide.subheading) bodyParas.push(para(slide.subheading, { size: 1800, bold: true }))
    for (const b of slide.bullets) bodyParas.push(para(b, { size: 1800, bullet: true }))
    if (slide.placeholder) {
      bodyParas.push(para('(placeholder — generate the source artifact to fill this in)', { size: 1400 }))
    }
    if (!bodyParas.length) bodyParas.push('<a:p><a:endParaRPr lang="en-US"/></a:p>')
    shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="body"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="685800" y="1600200"/><a:ext cx="10820400" cy="4800600"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${bodyParas.join('')}</p:txBody></p:sp>`,
    )
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    shapes.join('') +
    `</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping ` +
    `bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ` +
    `accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`
  )
}

/** [Content_Types].xml — declares every part's content type + slide overrides. */
function contentTypesXml(slideCount: number): string {
  const overrides = Array.from({ length: slideCount }, (_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    overrides +
    `</Types>`
  )
}

/** Package-level rels (_rels/.rels) → presentation. */
const PACKAGE_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
  `</Relationships>`

/** presentation.xml — slide size + master ref + ordered slide id list. */
function presentationXml(slideCount: number): string {
  const sldIds = Array.from({ length: slideCount }, (_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`,
  ).join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${sldIds}</p:sldIdLst>` +
    `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="screen16x9"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
  )
}

/** presentation rels — master (rId1) + one rel per slide (rId2..). */
function presentationRels(slideCount: number): string {
  const slideRels = Array.from({ length: slideCount }, (_, i) =>
    `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    slideRels +
    `</Relationships>`
  )
}

/** Minimal slide master (references the one layout). */
const SLIDE_MASTER =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
  `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
  `<p:cSld><p:spTree>` +
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
  `</p:spTree></p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ` +
  `accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`

const SLIDE_MASTER_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
  `</Relationships>`

/** Minimal blank slide layout (type="blank"), tied back to the master. */
const SLIDE_LAYOUT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
  `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">` +
  `<p:cSld name="Blank"><p:spTree>` +
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
  `</p:spTree></p:cSld>` +
  `<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ` +
  `accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sldLayout>`

const SLIDE_LAYOUT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
  `</Relationships>`

/** Minimal theme with a brand-derived accent1, so the deck picks up the company color. */
function themeXml(brandColor: string): string {
  const accent = hex(brandColor)
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Brand">` +
    `<a:themeElements><a:clrScheme name="Brand">` +
    `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
    `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
    `<a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>` +
    `<a:accent1><a:srgbClr val="${accent}"/></a:accent1>` +
    `<a:accent2><a:srgbClr val="${accent}"/></a:accent2>` +
    `<a:accent3><a:srgbClr val="595959"/></a:accent3><a:accent4><a:srgbClr val="7F7F7F"/></a:accent4>` +
    `<a:accent5><a:srgbClr val="A6A6A6"/></a:accent5><a:accent6><a:srgbClr val="D9D9D9"/></a:accent6>` +
    `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="Brand"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Brand"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
    `<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>` +
    `</a:fmtScheme></a:themeElements></a:theme>`
  )
}

/**
 * Serialize a DeckModel into a valid .pptx buffer (Uint8Array), themed with the
 * company brand color. One slide per model slide, cover first. No new dependency:
 * uses jszip (already in package.json). Returns raw bytes the route streams as a
 * downloadable file.
 */
export async function deckToPptx(model: DeckModel): Promise<Uint8Array> {
  const zip = new JSZip()
  const slides = model.slides
  const brandColor = normalizeDeckColor(model.brand.color)

  zip.file('[Content_Types].xml', contentTypesXml(slides.length))
  zip.file('_rels/.rels', PACKAGE_RELS)

  zip.file('ppt/presentation.xml', presentationXml(slides.length))
  zip.file('ppt/_rels/presentation.xml.rels', presentationRels(slides.length))

  zip.file('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', SLIDE_MASTER_RELS)
  zip.file('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', SLIDE_LAYOUT_RELS)
  zip.file('ppt/theme/theme1.xml', themeXml(brandColor))

  slides.forEach((slide, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(slide, brandColor))
  })

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

/** A safe download filename for a company's pitch deck (e.g. "acme-pitch-deck.pptx"). */
export function deckFileName(name: string, ext: 'pptx' | 'txt' = 'pptx'): string {
  const slug = (name || 'company')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'company'
  return `${slug}-pitch-deck.${ext}`
}
