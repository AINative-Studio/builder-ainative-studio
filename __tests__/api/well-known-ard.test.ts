import { describe, it, expect } from 'vitest'
import { GET } from '@/app/.well-known/ard.json/route'

/**
 * #1839 — ARD (Agent Resource Discovery) manifest. ARD is a real external
 * standard (agenticresourcediscovery.org), mirrored from ainative.studio's
 * own real public/.well-known/ard.json, adapted to Builder's own real,
 * live resources.
 */
describe('GET /.well-known/ard.json', () => {
  it('returns a valid entries array with real Builder resources', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(Array.isArray(doc.entries)).toBe(true)
    expect(doc.entries.length).toBeGreaterThan(0)
  })

  it('every entry has the required ARD fields', async () => {
    const res = await GET()
    const doc = await res.json()
    for (const entry of doc.entries) {
      expect(typeof entry.identifier).toBe('string')
      expect(typeof entry.displayName).toBe('string')
      expect(typeof entry.type).toBe('string')
      expect(typeof entry.url).toBe('string')
      expect(entry.trustManifest?.identity?.issuer).toBe('builder.ainative.studio')
    }
  })

  it('references real, already-shipping Builder endpoints, not placeholders', async () => {
    const res = await GET()
    const doc = await res.json()
    const urls = doc.entries.map((e: { url: string }) => e.url)
    expect(urls.some((u: string) => u.includes('/llms.txt'))).toBe(true)
    expect(urls.some((u: string) => u.includes('/.well-known/provisioning'))).toBe(true)
  })

  it('is cacheable', async () => {
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toContain('max-age')
  })
})
