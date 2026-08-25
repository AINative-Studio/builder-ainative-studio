/**
 * Pitch-deck composition model (#69) — the PURE logic that turns a company's
 * already-generated artifacts (venture thesis, product roadmap, mission, market
 * research) plus its brand into a structured, standard-VC pitch-deck slide model.
 *
 * This is the deliverable a founder pays for: "you've made your company, now go
 * pitch it to VCs — here's a slick deck." (customer feedback 2026-08-24.)
 *
 * DESIGN — the deck composition is deliberately I/O-free so it is fully unit
 * testable without a network or a model call (same split as document-store.ts:
 * pure core, heavy I/O elsewhere). The route (app/api/build/deck) gathers the
 * artifacts (from the #64 Documents library, generating any missing ones via the
 * shared Claude stack) and the brand (from state / app-registry), calls
 * buildDeckModel() here, then serializes the model to a real PPTX file
 * (lib/build/deck-pptx.ts). Nothing here fabricates content: every slide's body
 * is derived from the artifacts the founder actually generated, and a slide
 * whose source artifact is absent is honestly marked as a placeholder to fill in.
 */

/** The standard VC pitch-deck section order (problem → … → ask), plus a title/cover. */
export const DECK_SECTIONS = [
  'title',
  'problem',
  'solution',
  'market',
  'product',
  'traction',
  'ask',
] as const
export type DeckSection = (typeof DECK_SECTIONS)[number]

/** The content sections (everything except the cover) a VC deck must cover. */
export const VC_SECTIONS: Exclude<DeckSection, 'title'>[] = [
  'problem',
  'solution',
  'market',
  'product',
  'traction',
  'ask',
]

/** Human heading for each section (slide title text). */
export const SECTION_HEADINGS: Record<DeckSection, string> = {
  title: 'Title',
  problem: 'Problem',
  solution: 'Solution',
  market: 'Market',
  product: 'Product',
  traction: 'Traction',
  ask: 'The Ask',
}

/** The company brand a deck is themed with (name/tagline/color from state/app-registry). */
export interface DeckBrand {
  name: string
  tagline?: string
  /** Brand accent as a #RRGGBB hex; falls back to the AINative brand when absent/invalid. */
  color?: string
}

/**
 * The raw artifacts a deck is composed from. Each value is the markdown body of
 * the corresponding durable document (#64) — venture thesis/mission, product
 * roadmap, market research, competitive research. All optional: a brand-new
 * company may not have generated every one yet, and the model degrades honestly.
 */
export interface DeckArtifacts {
  /** The venture thesis / mission — problem, who, wedge, why-now. */
  thesis?: string
  mission?: string
  /** Product roadmap (Now / Next / Later milestones). */
  roadmap?: string
  /** Market research (segment, size, demand). */
  market?: string
  /** Competitive research / audit. */
  research?: string
  /** Optional explicit idea one-liner (drives the cover subtitle when no tagline). */
  idea?: string
}

/** One composed slide in the deck model. */
export interface DeckSlide {
  section: DeckSection
  /** The slide heading (e.g. "Problem"). For the cover this is the company name. */
  heading: string
  /** Optional sub-heading (tagline on the cover; a framing line elsewhere). */
  subheading?: string
  /** Body bullet points — concrete, derived from the artifacts (never lorem). */
  bullets: string[]
  /**
   * True when the source artifact was absent, so the bullets are a neutral
   * placeholder prompting the founder to generate that artifact first. The UI /
   * export can flag these; they are NEVER fabricated as if real.
   */
  placeholder: boolean
}

/** The full, serializable deck model consumed by the PPTX/PDF exporters. */
export interface DeckModel {
  brand: DeckBrand
  slides: DeckSlide[]
  /** How many content slides are backed by a real artifact (vs placeholder). */
  filledSections: number
  totalSections: number
  generatedAt: string
}

/** The AINative brand accent, used when a company has no valid brand color. */
export const DEFAULT_DECK_COLOR = '#0A0A0A'
const HEX_RE = /^#[0-9a-fA-F]{6}$/

/** Normalize a brand color to a safe #RRGGBB (uppercased), or the default. */
export function normalizeDeckColor(color?: string): string {
  const c = (color || '').trim()
  return HEX_RE.test(c) ? c.toUpperCase() : DEFAULT_DECK_COLOR
}

/**
 * Split a markdown artifact into clean bullet lines, tolerant of the shapes the
 * generators emit: markdown list items (`- `, `* `, `1. `), and paragraph
 * sentences as a fallback. Strips markdown headings, code fences, emphasis marks,
 * and blank lines. Returns [] for empty/whitespace input.
 */
export function extractBullets(markdown: string | undefined, max = 5): string[] {
  const text = (markdown || '').trim()
  if (!text) return []

  const lines = text.split(/\r?\n/)
  const out: string[] = []
  const seen = new Set<string>()

  const push = (raw: string) => {
    const clean = cleanInline(raw)
    if (clean.length < 3) return
    const key = clean.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(clean)
  }

  // 1) Prefer real list items.
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (m && m[1].trim()) push(m[1])
    if (out.length >= max) return out.slice(0, max)
  }
  if (out.length > 0) return out.slice(0, max)

  // 2) Fallback: sentences from the prose (skip headings / fenced code / table rows).
  let inFence = false
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('```')) { inFence = !inFence; continue }
    if (inFence || !t || t.startsWith('#') || t.startsWith('|')) continue
    // Split a paragraph into sentences so a bullet is not a whole wall of text.
    for (const sentence of t.split(/(?<=[.!?])\s+/)) {
      if (sentence.trim().length >= 3) push(sentence)
      if (out.length >= max) return out.slice(0, max)
    }
    if (out.length >= max) break
  }
  return out.slice(0, max)
}

/** Strip inline markdown (emphasis, links, code, heading marks) from one line. */
function cleanInline(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pull the "## Key Findings" section body out of a #64 structured document (whose
 * contract is `## Executive Summary` / `## Key Findings` / `## Sources`). Falls
 * back to the whole document when no such section exists (e.g. an artifact-route
 * doc that is plain prose). Never throws.
 */
export function keyFindings(markdown: string | undefined): string {
  const text = (markdown || '').trim()
  if (!text) return ''
  const m = text.match(/##\s*Key Findings\s*\n([\s\S]*?)(?:\n##\s|\s*$)/i)
  return (m ? m[1] : text).trim()
}

/**
 * Pull the "## Executive Summary" first sentence(s) as a framing sub-heading.
 * Returns '' when absent. Trimmed to a single tight line.
 */
export function execSummaryLine(markdown: string | undefined): string {
  const text = (markdown || '').trim()
  if (!text) return ''
  const m = text.match(/##\s*Executive Summary\s*\n([\s\S]*?)(?:\n##\s|\s*$)/i)
  if (!m) return ''
  const body = cleanInline(m[1].split(/\r?\n/).find((l) => l.trim())?.trim() || '')
  return body.slice(0, 160)
}

/** Neutral, honest placeholder bullets for a section whose artifact is absent. */
function placeholderBullets(section: DeckSection, brand: DeckBrand): string[] {
  const name = brand.name || 'your company'
  const prompt: Record<Exclude<DeckSection, 'title'>, string> = {
    problem: `Generate the venture thesis for ${name} to fill in the problem this company solves.`,
    solution: `Generate the mission/thesis for ${name} to describe the solution and wedge.`,
    market: `Generate the market research document for ${name} to size the opportunity.`,
    product: `Generate the product roadmap for ${name} to lay out what ships and when.`,
    traction: `Traction fills in as ${name} runs — pipeline, users, and revenue from the live systems.`,
    ask: `Set the raise amount, use of funds, and milestones for ${name}.`,
  }
  return [prompt[section as Exclude<DeckSection, 'title'>]]
}

/**
 * Compose a standard-VC pitch-deck model from a company's artifacts + brand.
 *
 * Section → artifact mapping (all derived, never fabricated):
 *   problem   ← thesis / mission (the problem + who)
 *   solution  ← mission / thesis (the solution + wedge)
 *   market    ← market research (segment, size, demand)
 *   product   ← product roadmap (Now / Next / Later)
 *   traction  ← competitive research / (live counts injected by the route as bullets)
 *   ask       ← caller-provided ask, else an honest placeholder
 *
 * A section with no backing artifact gets a single honest placeholder bullet and
 * is flagged `placeholder: true`, so nothing is invented. The cover slide is the
 * brand (name + tagline/idea). Pure + deterministic (except generatedAt, which the
 * caller can override for reproducible tests).
 */
export function buildDeckModel(
  artifacts: DeckArtifacts,
  brand: DeckBrand,
  opts?: { ask?: string[]; traction?: string[]; generatedAt?: string },
): DeckModel {
  const safeBrand: DeckBrand = {
    name: (brand.name || 'Your Company').trim().slice(0, 120),
    tagline: (brand.tagline || '').trim().slice(0, 200) || undefined,
    color: normalizeDeckColor(brand.color),
  }

  const problemSrc = artifacts.thesis || artifacts.mission
  const solutionSrc = artifacts.mission || artifacts.thesis

  const slides: DeckSlide[] = []

  // Cover slide — the brand.
  slides.push({
    section: 'title',
    heading: safeBrand.name,
    subheading: safeBrand.tagline || (artifacts.idea || '').trim().slice(0, 200) || undefined,
    bullets: [],
    placeholder: false,
  })

  const sectionOf = (
    section: Exclude<DeckSection, 'title'>,
    src: string | undefined,
    override?: string[],
  ): DeckSlide => {
    const bullets =
      override && override.length
        ? override.slice(0, 6).map((b) => cleanInline(b)).filter((b) => b.length >= 3)
        : extractBullets(keyFindings(src))
    const filled = bullets.length > 0
    return {
      section,
      heading: SECTION_HEADINGS[section],
      subheading: execSummaryLine(src) || undefined,
      bullets: filled ? bullets : placeholderBullets(section, safeBrand),
      placeholder: !filled,
    }
  }

  slides.push(sectionOf('problem', problemSrc))
  slides.push(sectionOf('solution', solutionSrc))
  slides.push(sectionOf('market', artifacts.market))
  slides.push(sectionOf('product', artifacts.roadmap))
  slides.push(sectionOf('traction', artifacts.research, opts?.traction))
  slides.push(sectionOf('ask', undefined, opts?.ask))

  const contentSlides = slides.filter((s) => s.section !== 'title')
  const filledSections = contentSlides.filter((s) => !s.placeholder).length

  return {
    brand: safeBrand,
    slides,
    filledSections,
    totalSections: contentSlides.length,
    generatedAt: opts?.generatedAt || new Date().toISOString(),
  }
}

/**
 * A plain-text rendering of the deck model — used as a lightweight, dependency-free
 * export fallback and as a stable target for unit tests. Deterministic.
 */
export function deckToText(model: DeckModel): string {
  const lines: string[] = []
  for (const s of model.slides) {
    lines.push('='.repeat(60))
    if (s.section === 'title') {
      lines.push(s.heading)
      if (s.subheading) lines.push(s.subheading)
    } else {
      lines.push(`${SECTION_HEADINGS[s.section]}`)
      if (s.subheading) lines.push(s.subheading)
      for (const b of s.bullets) lines.push(`  • ${b}`)
      if (s.placeholder) lines.push('  (placeholder — generate the source artifact to fill this in)')
    }
    lines.push('')
  }
  return lines.join('\n').trim() + '\n'
}
