import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * lib/build/discovery-files.ts — real bug repro (2026-09).
 *
 * lib/ainative-file-generator.ts's generateAINativeFileSet() is real and
 * correct, but was only ever wired into the manual "Export ZIP" download —
 * confirmed live: builder.ainative.studio/llms.txt (the platform's own)
 * returns a real 200, builder.ainative.studio/build/{any real company}/
 * llms.txt 404s. Every generated company's live site was invisible to
 * AI-agent discovery despite fully correct generation code sitting unused.
 * resolveDiscoveryFile() regenerates on-demand from the durable stored code
 * (resolveStoredApp) so it works even for companies generated before this
 * fix shipped, with no backfill needed.
 */

const h = vi.hoisted(() => ({
  resolveAppVerified: vi.fn(),
  resolveStoredApp: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/ready-gate', () => ({ resolveStoredApp: h.resolveStoredApp }))

import { resolveDiscoveryFile, discoveryContentType } from '@/lib/build/discovery-files'

describe('resolveDiscoveryFile', () => {
  beforeEach(() => {
    h.resolveAppVerified.mockReset()
    h.resolveStoredApp.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('returns null for a blank slug without calling resolveAppVerified', async () => {
    expect(await resolveDiscoveryFile('', 'llms.txt')).toBeNull()
    expect(h.resolveAppVerified).not.toHaveBeenCalled()
  })

  it('returns null (honest 404) for a confirmed-absent company — never fabricates content', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    expect(await resolveDiscoveryFile('nonexistent', 'llms.txt')).toBeNull()
  })

  it('returns null when the company is registered but has no chatId', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { name: 'Acme', slug: 'acme' }, verified: true })
    expect(await resolveDiscoveryFile('acme', 'llms.txt')).toBeNull()
  })

  it('returns null when there is no durable stored code for the chatId', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { name: 'Acme', slug: 'acme', chatId: 'chat-1' }, verified: true })
    h.resolveStoredApp.mockResolvedValue(null)
    expect(await resolveDiscoveryFile('acme', 'llms.txt')).toBeNull()
  })

  it('returns real generated llms.txt content for a real company', async () => {
    h.resolveAppVerified.mockResolvedValue({
      entry: { name: 'Beacon', slug: 'beacon', chatId: 'chat-1', tagline: 'Crosspost everywhere' },
      verified: true,
    })
    h.resolveStoredApp.mockResolvedValue({ code: 'export default function App(){ return <div/> }', files: null })
    const content = await resolveDiscoveryFile('beacon', 'llms.txt')
    expect(content).toContain('Beacon')
  })

  it('uses the real live /build/{slug} URL as the domain, not a placeholder .app', async () => {
    h.resolveAppVerified.mockResolvedValue({
      entry: { name: 'Beacon', slug: 'beacon', chatId: 'chat-1', tagline: 'Crosspost everywhere' },
      verified: true,
    })
    h.resolveStoredApp.mockResolvedValue({ code: 'export default function App(){ return <div/> }', files: null })
    const content = await resolveDiscoveryFile('beacon', 'robots.txt')
    expect(content).toContain('https://builder.ainative.studio/build/beacon')
  })

  it('uses the company\'s real custom domain when one is set, instead of the /build/{slug} path', async () => {
    h.resolveAppVerified.mockResolvedValue({
      entry: { name: 'Beacon', slug: 'beacon', chatId: 'chat-1', tagline: 't', domain: 'beacon.app' },
      verified: true,
    })
    h.resolveStoredApp.mockResolvedValue({ code: 'export default function App(){ return <div/> }', files: null })
    const content = await resolveDiscoveryFile('beacon', 'sitemap.xml')
    expect(content).toContain('https://beacon.app')
  })

  it('resolves all 5 real discovery file kinds with distinct, correct content types', async () => {
    h.resolveAppVerified.mockResolvedValue({
      entry: { name: 'Beacon', slug: 'beacon', chatId: 'chat-1', tagline: 't' },
      verified: true,
    })
    h.resolveStoredApp.mockResolvedValue({ code: 'export default function App(){ return <div/> }', files: null })
    for (const key of ['llms.txt', 'robots.txt', 'sitemap.xml', 'ai-plugin.json', 'security.txt'] as const) {
      const content = await resolveDiscoveryFile('beacon', key)
      expect(content).toBeTruthy()
      expect(typeof content).toBe('string')
    }
    expect(discoveryContentType('llms.txt')).toBe('text/plain; charset=utf-8')
    expect(discoveryContentType('sitemap.xml')).toBe('application/xml; charset=utf-8')
    expect(discoveryContentType('ai-plugin.json')).toBe('application/json; charset=utf-8')
  })

  // #1432: a transient registry-read failure must return a THIRD, distinct
  // state (undefined) rather than collapsing onto the same null a confirmed-
  // absent company returns — see resolveDiscoveryFile()'s doc comment.
  it('returns undefined (not null) when the registry lookup itself could not be verified', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const result = await resolveDiscoveryFile('beacon', 'llms.txt')
    expect(result).toBeUndefined()
    expect(h.resolveStoredApp).not.toHaveBeenCalled()
  })

  it('never throws — a resolveStoredApp failure returns null, not an exception', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { name: 'Beacon', slug: 'beacon', chatId: 'chat-1' }, verified: true })
    h.resolveStoredApp.mockRejectedValue(new Error('zerodb timeout'))
    await expect(resolveDiscoveryFile('beacon', 'llms.txt')).resolves.toBeNull()
  })
})
