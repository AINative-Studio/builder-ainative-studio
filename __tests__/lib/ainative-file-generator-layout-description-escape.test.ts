import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import { generateNextLayoutTs, type AppMetadata } from '@/lib/ainative-file-generator'

function baseMeta(overrides: Partial<AppMetadata> = {}): AppMetadata {
  return {
    name: 'App',
    description: 'A simple landing page.',
    type: 'docs',
    features: [],
    pages: ['/'],
    ...overrides,
  }
}

function parseTsx(code: string) {
  return parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
}

describe('generateNextLayoutTs — meta.description escaping (#1971)', () => {
  it('reproduces the live bug shape: a pasted multi-line prompt no longer breaks the string literal', () => {
    // Exact shape confirmed live on https-value-eco-K_q91O's /app/layout.tsx:
    // a founder prompt with URLs pasted on separate lines.
    const description =
      'Build a real, working, functional application for "Value Economy" that actually implements this idea: https://value-eco.super.site/\nhttps://value-eco.super.site/alliance\nhttps://value-eco.super.site/a'
    const code = generateNextLayoutTs(baseMeta({ description }))

    expect(() => parseTsx(code)).not.toThrow()
  })

  it('escapes a literal backslash so it cannot swallow the closing quote', () => {
    const code = generateNextLayoutTs(baseMeta({ description: 'Ends with a backslash\\' }))
    expect(() => parseTsx(code)).not.toThrow()
  })

  it('escapes CRLF line endings, not just bare \\n', () => {
    const code = generateNextLayoutTs(baseMeta({ description: 'Line one\r\nLine two' }))
    expect(() => parseTsx(code)).not.toThrow()
  })

  it('still escapes single quotes as before (no regression)', () => {
    const code = generateNextLayoutTs(baseMeta({ description: `Founder's "quoted" idea` }))
    expect(() => parseTsx(code)).not.toThrow()
    expect(code).toContain("Founder\\'s")
  })

  it('preserves ordinary single-line descriptions unchanged in content', () => {
    const code = generateNextLayoutTs(baseMeta({ description: 'A plain description with no special characters' }))
    expect(code).toContain("description: 'A plain description with no special characters',")
  })

  it('applies the same escaping to the truncated openGraph/twitter descriptions', () => {
    const longMultiline = 'Line A\nLine B\n'.repeat(20) // > 160 chars once joined
    const code = generateNextLayoutTs(baseMeta({ description: longMultiline }))
    expect(() => parseTsx(code)).not.toThrow()
    expect(code).toMatch(/openGraph:/)
    expect(code).toMatch(/twitter:/)
  })
})
