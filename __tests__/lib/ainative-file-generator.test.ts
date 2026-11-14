import { describe, it, expect } from 'vitest'
import { generateAINativeFileSet, extractAppMetadata } from '@/lib/ainative-file-generator'

/**
 * Real production incident (2026-09): PR #494 wired generateAINativeFileSet()
 * into live serving via lib/build/discovery-files.ts, which passed
 * `{ description: entry.tagline || undefined }` as overrides for a company
 * with no tagline. `{ ...extractAppMetadata(...), ...overrides }` let that
 * explicit `undefined` key overwrite the real computed description, and
 * generateAiPluginJson's `meta.description.replace(...)` threw on undefined
 * — a real 500 confirmed live at builder.ainative.studio/build/beacon/llms.txt
 * immediately after deploy. Fixed by filtering undefined-valued override keys
 * before the spread, both at the call site and defensively here.
 */

describe('generateAINativeFileSet — overrides never clobber real defaults with undefined', () => {
  it('an override object containing an explicit undefined key does not break generation', () => {
    // Reproduces the exact real-world shape: a caller building an overrides
    // object with a key present but set to undefined (e.g. `x || undefined`).
    const files = generateAINativeFileSet('a real idea', 'export default function App(){}', {
      name: 'Beacon',
      description: undefined,
      domain: 'https://builder.ainative.studio/build/beacon',
    })
    expect(files['public/.well-known/ai-plugin.json']).toBeTruthy()
    expect(() => JSON.parse(files['public/.well-known/ai-plugin.json'])).not.toThrow()
  })

  it('a defined description override is honored', () => {
    const files = generateAINativeFileSet('a real idea', 'export default function App(){}', {
      description: 'Real company tagline',
    })
    expect(files['public/.well-known/ai-plugin.json']).toContain('Real company tagline')
  })

  it('with no overrides at all, the heuristic description from the prompt is used', () => {
    const files = generateAINativeFileSet('a crossposting tool for social media', 'export default function App(){}')
    expect(files['public/.well-known/ai-plugin.json']).toContain('crossposting')
  })

  it('generates all 8 real files without throwing for a minimal real payload', () => {
    const files = generateAINativeFileSet('an idea', 'export default function App(){ return null }', {
      name: 'Acme',
      domain: 'https://builder.ainative.studio/build/acme',
    })
    expect(Object.keys(files)).toHaveLength(8)
    for (const [path, content] of Object.entries(files)) {
      expect(typeof content).toBe('string')
      expect(content.length).toBeGreaterThan(0)
    }
  })
})

describe('extractAppMetadata', () => {
  it('always returns a real, non-empty description derived from the prompt', () => {
    const meta = extractAppMetadata('build me a crossposting tool', 'export default function App(){}')
    expect(meta.description).toBe('build me a crossposting tool')
  })

  /**
   * Real incident (2026-11-11): every sampled live company (wrench, lumeo,
   * shingle, tidemark) served layout.tsx metadata (<title>, OG/Twitter tags,
   * metadataBase domain) literally reading "this" / "https://this.app". The
   * old `prompt.match(/called\s+(\w+)/i) || prompt.match(/for\s+(\w+)/i)`
   * fallback scanned the WHOLE prompt unanchored and always locked onto the
   * company-app/route.ts template's own SECOND "for" — "...a real company
   * for this idea: ..." — capturing the word "this" instead of the real,
   * quoted company name earlier in the same string.
   */
  it('extracts the real quoted company name from the landing-page template, not the literal word "this"', () => {
    const prompt =
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Wrench" (tagline: "From job site to paid — on autopilot.") — a real company for this idea: A field service management platform.'
    const meta = extractAppMetadata(prompt, 'export default function App(){}')
    expect(meta.name).toBe('Wrench')
    expect(meta.name).not.toBe('this')
  })

  it('extracts the quoted company name from the landing-page template with no tagline', () => {
    const prompt =
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Lumeo" — a real company for this idea: A knowledge marketplace.'
    const meta = extractAppMetadata(prompt, 'export default function App(){}')
    expect(meta.name).toBe('Lumeo')
  })

  it('extracts the quoted company name from the store-teaser template', () => {
    const prompt =
      'Build a polished, production-quality single-page STORE TEASER for "Driftwood" — a real, direct-to-consumer storefront for this idea: a candle shop.'
    const meta = extractAppMetadata(prompt, 'export default function App(){}')
    expect(meta.name).toBe('Driftwood')
  })

  it('extracts a founder-named idea opening ("Name — ...") from the App-track dashboard wrapper', () => {
    const prompt =
      'Build a polished, working web app for this idea: Tidemark — your community, clearly visible: a community visibility dashboard where members post updates. Make it interactive.'
    const meta = extractAppMetadata(prompt, 'export default function App(){}')
    expect(meta.name).toBe('Tidemark')
  })

  it('never returns a stopword like "this"/"a"/"the" as the name', () => {
    const prompts = [
      'Build a polished, working web app for this idea: a habit tracker with streaks. Make it interactive.',
      'Build a polished, working web app for this idea: I would like to build an app that connects volunteer firefighters.',
    ]
    for (const prompt of prompts) {
      const meta = extractAppMetadata(prompt, 'export default function App(){}')
      expect(['this', 'a', 'an', 'the']).not.toContain(meta.name.toLowerCase())
    }
  })

  it('still honors "called X" naming when present', () => {
    const meta = extractAppMetadata('build me an app called Beacon for tracking leads', 'export default function App(){}')
    expect(meta.name).toBe('Beacon')
  })

  it('does not mistake the boilerplate "production-quality" phrase for a "product" keyword and misclassify as ecommerce', () => {
    const prompts = [
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Gable" (tagline: "Close more roofs, less chaos.") — a real company for this idea: A B2B sales CRM for roofing contractors (helps manage leads, bids, and crews).',
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Dispatch" (tagline: "Your mobile workforce, perfectly orchestrated.") — a real company for this idea: A field service management platform for small businesses.',
    ]
    for (const prompt of prompts) {
      const meta = extractAppMetadata(prompt, 'export default function App(){}')
      expect(meta.type).not.toBe('ecommerce')
    }
  })

  it('still detects a genuinely ecommerce idea even through the "production-quality" boilerplate', () => {
    const meta = extractAppMetadata(
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Crate" — a real company for this idea: an online store selling handmade furniture, with a product catalog and shopping cart.',
      'export default function App(){}',
    )
    expect(meta.type).toBe('ecommerce')
  })
})
