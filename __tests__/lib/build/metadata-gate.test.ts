import { describe, it, expect } from 'vitest'
import { checkMetadataFreshness } from '@/lib/build/metadata-gate'

/**
 * Metadata freshness gate — detects the two confirmed, already-fixed
 * extractAppMetadata() bugs (#1952 literal "this" name, #2024 "Ecommerce
 * Application" mislabel) still live in a company's PERSISTED
 * `/app/layout.tsx`. See lib/build/metadata-gate.ts's doc comment for the
 * full incident history.
 */

const WRENCH_PROMPT =
  'Build a polished, production-quality single-page marketing LANDING PAGE for "Wrench" ' +
  '(tagline: "From job site to paid — on autopilot.") — a real company for this idea: ' +
  'A field service management platform for small businesses.'

const ECOMMERCE_PROMPT =
  'Build a polished, production-quality single-page marketing LANDING PAGE for "Crate" ' +
  '— a real company for this idea: an online store selling handmade furniture, with a product catalog and shopping cart.'

function layoutTsWithTitle(name: string, type: string, domain = `https://${name.toLowerCase()}.app`): string {
  return `export const metadata: Metadata = {
  title: '${name} — ${type} Application',
  description: 'whatever',
  metadataBase: new URL('${domain}'),
}
export default function RootLayout() { return null }
`
}

describe('checkMetadataFreshness', () => {
  it('flags the #1952 literal "this" name bug', () => {
    const layout = layoutTsWithTitle('this', 'Ecommerce', 'https://this.app')
    const r = checkMetadataFreshness(WRENCH_PROMPT, '', layout)
    expect(r.stale).toBe(true)
    expect(r.reasons.some((x) => x.includes('#1952'))).toBe(true)
  })

  it('flags the literal "https://this.app" metadataBase even if the title name looks fine', () => {
    const layout = layoutTsWithTitle('Wrench', 'Saas', 'https://this.app')
    const r = checkMetadataFreshness(WRENCH_PROMPT, '', layout)
    expect(r.stale).toBe(true)
    expect(r.reasons.some((x) => x.includes('metadataBase'))).toBe(true)
  })

  it('flags the #2024 "Ecommerce Application" mislabel for a real non-ecommerce company', () => {
    const layout = layoutTsWithTitle('Wrench', 'Ecommerce', 'https://wrench.app')
    const r = checkMetadataFreshness(WRENCH_PROMPT, '', layout)
    expect(r.stale).toBe(true)
    expect(r.reasons.some((x) => x.includes('#2024'))).toBe(true)
  })

  it('does NOT flag a genuinely ecommerce company labeled "Ecommerce Application"', () => {
    const layout = layoutTsWithTitle('Crate', 'Ecommerce', 'https://crate.app')
    const r = checkMetadataFreshness(ECOMMERCE_PROMPT, '', layout)
    expect(r.stale).toBe(false)
    expect(r.reasons).toEqual([])
  })

  it('does NOT flag a clean, correctly-labeled company', () => {
    const layout = layoutTsWithTitle('Wrench', 'Saas', 'https://wrench.app')
    const r = checkMetadataFreshness(WRENCH_PROMPT, '', layout)
    expect(r.stale).toBe(false)
    expect(r.reasons).toEqual([])
  })

  it('reports both bugs at once when both are present', () => {
    const layout = layoutTsWithTitle('this', 'Ecommerce', 'https://this.app')
    const r = checkMetadataFreshness(WRENCH_PROMPT, '', layout)
    expect(r.reasons.length).toBeGreaterThanOrEqual(2)
    expect(r.reasons.some((x) => x.includes('metadataBase'))).toBe(true)
    expect(r.reasons.some((x) => x.includes('#2024'))).toBe(true)
  })

  it('is a no-op on an empty/missing layout.tsx (e.g. single-file-only generation)', () => {
    const r = checkMetadataFreshness(WRENCH_PROMPT, '', '')
    expect(r.stale).toBe(false)
    expect(r.reasons).toEqual([])
  })

  it('is a no-op when the title does not match the expected shape at all (custom/hand-edited layout)', () => {
    const layout = `export const metadata = { title: 'Something totally custom' }`
    const r = checkMetadataFreshness(WRENCH_PROMPT, '', layout)
    expect(r.stale).toBe(false)
  })
})
