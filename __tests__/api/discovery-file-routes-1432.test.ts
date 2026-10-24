import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Route-level coverage for #1432: the 4 per-company discovery-file routes
 * (llms.txt, robots.txt, sitemap.xml, .well-known/ai-plugin.json,
 * .well-known/security.txt) must map resolveDiscoveryFile()'s new
 * undefined/null distinction onto 503 (lookup failed) vs. 404 (confirmed
 * absent), never collapsing the two the way the pre-#1432 code did.
 */

const h = vi.hoisted(() => ({ resolveDiscoveryFile: vi.fn() }))

vi.mock('@/lib/build/discovery-files', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/discovery-files')>(
    '@/lib/build/discovery-files',
  )
  return { ...actual, resolveDiscoveryFile: h.resolveDiscoveryFile }
})

const ROUTES: Array<{ path: string; key: string }> = [
  { path: '@/app/build/[slug]/llms.txt/route', key: 'llms.txt' },
  { path: '@/app/build/[slug]/robots.txt/route', key: 'robots.txt' },
  { path: '@/app/build/[slug]/sitemap.xml/route', key: 'sitemap.xml' },
  { path: '@/app/build/[slug]/.well-known/ai-plugin.json/route', key: 'ai-plugin.json' },
  { path: '@/app/build/[slug]/.well-known/security.txt/route', key: 'security.txt' },
]

describe.each(ROUTES)('GET /build/[slug]/$key route', ({ path, key }) => {
  beforeEach(() => h.resolveDiscoveryFile.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('returns 503 when the registry lookup could not be verified (not a fabricated 404)', async () => {
    h.resolveDiscoveryFile.mockResolvedValue(undefined)
    const { GET } = await import(path)
    const res = await GET({} as never, { params: Promise.resolve({ slug: 'beacon' }) })
    expect(res.status).toBe(503)
  })

  it('returns 404 for a confirmed-absent company', async () => {
    h.resolveDiscoveryFile.mockResolvedValue(null)
    const { GET } = await import(path)
    const res = await GET({} as never, { params: Promise.resolve({ slug: 'nonexistent' }) })
    expect(res.status).toBe(404)
  })

  it('returns the real generated content with a 200', async () => {
    h.resolveDiscoveryFile.mockResolvedValue(`real ${key} content`)
    const { GET } = await import(path)
    const res = await GET({} as never, { params: Promise.resolve({ slug: 'beacon' }) })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(`real ${key} content`)
  })
})
