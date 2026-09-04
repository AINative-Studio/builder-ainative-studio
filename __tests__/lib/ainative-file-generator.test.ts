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
})
