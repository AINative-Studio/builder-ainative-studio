import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1202 (Coverage Phase 2 follow-up) — app/api/build/logo/route.ts (#492)
 * had zero route-level coverage. Uses real multipart FormData/File objects
 * (jsdom/undici provide these natively) so the route's own form-parsing runs
 * for real; only auth, the app registry, and media storage are mocked.
 */

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: auth.auth }))

const chatStore = vi.hoisted(() => ({
  deriveOwnerKey: vi.fn(() => 'founder@x.com'),
  chatScopeKey: vi.fn((owner: string, slug: string) => `${owner}:${slug}`),
}))
vi.mock('@/lib/build/chat-store', () => chatStore)

const appRegistry = vi.hoisted(() => ({ resolveApp: vi.fn(), resolveAppVerified: vi.fn(), setAppLogo: vi.fn() }))
vi.mock('@/lib/build/app-registry', () => appRegistry)

/** A confirmed resolveAppVerified() result — either a real entry or a confirmed miss. */
function verified(entry: Record<string, unknown> | null) {
  return { entry, verified: true }
}

const mediaSchedule = vi.hoisted(() => ({ uploadMediaFile: vi.fn(), fetchFileDownload: vi.fn() }))
vi.mock('@/lib/build/media-schedule', () => mediaSchedule)

import { mockGetRequest } from '../helpers/api-route-harness'

function multipartRequest(url: string, fields: Record<string, string | Blob>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v as any)
  return new NextRequest(url, { method: 'POST', body: form as any })
}

beforeEach(() => {
  vi.clearAllMocks()
  chatStore.deriveOwnerKey.mockReturnValue('founder@x.com')
  chatStore.chatScopeKey.mockImplementation((owner: string, slug: string) => `${owner}:${slug}`)
})

describe('#1202 GET /api/build/logo', () => {
  it('returns 400 for a malformed file id', async () => {
    const { GET } = await import('@/app/api/build/logo/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/logo?id=not-a-valid-id!!'))

    expect(res.status).toBe(400)
  })

  it('returns 404 when the file id does not resolve to a download', async () => {
    mediaSchedule.fetchFileDownload.mockResolvedValue(null)
    const { GET } = await import('@/app/api/build/logo/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/build/logo?id=123e4567-e89b-12d3-a456-426614174000')
    )

    expect(res.status).toBe(404)
  })

  it('returns 415 for an unsupported content type', async () => {
    mediaSchedule.fetchFileDownload.mockResolvedValue({ url: 'https://bucket/x', contentType: 'application/pdf' })
    const { GET } = await import('@/app/api/build/logo/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/build/logo?id=123e4567-e89b-12d3-a456-426614174000')
    )

    expect(res.status).toBe(415)
  })

  it('302-redirects to a fresh presigned url for an allowed type', async () => {
    mediaSchedule.fetchFileDownload.mockResolvedValue({ url: 'https://bucket/logo.png', contentType: 'image/png' })
    const { GET } = await import('@/app/api/build/logo/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/build/logo?id=123e4567-e89b-12d3-a456-426614174000')
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://bucket/logo.png')
  })

  it('returns 400 when companyId is missing', async () => {
    const { GET } = await import('@/app/api/build/logo/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/logo'))

    expect(res.status).toBe(400)
  })

  it("returns the company's current logo url", async () => {
    appRegistry.resolveApp.mockResolvedValue({ logoUrl: 'https://bucket/current-logo.png' })
    const { GET } = await import('@/app/api/build/logo/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/logo?companyId=acme'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://bucket/current-logo.png')
  })

  it('returns a null url when the company has no logo yet', async () => {
    appRegistry.resolveApp.mockResolvedValue({ logoUrl: undefined })
    const { GET } = await import('@/app/api/build/logo/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/logo?companyId=acme'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBeNull()
  })
})

describe('#1202 POST /api/build/logo', () => {
  it('returns 401 when there is no signed-in session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/logo/route')

    const res = await POST(multipartRequest('http://localhost/api/build/logo', { companyId: 'acme' }))

    expect(res.status).toBe(401)
  })

  it('returns 401 for a guest session', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'guest@x.com', type: 'guest' } })
    const { POST } = await import('@/app/api/build/logo/route')

    const res = await POST(multipartRequest('http://localhost/api/build/logo', { companyId: 'acme' }))

    expect(res.status).toBe(401)
  })

  it('returns 400 when companyId is missing from the form', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    const { POST } = await import('@/app/api/build/logo/route')

    const res = await POST(multipartRequest('http://localhost/api/build/logo', {}))

    expect(res.status).toBe(400)
  })

  it('returns 404 when the company does not exist', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    appRegistry.resolveAppVerified.mockResolvedValue(verified(null))
    const { POST } = await import('@/app/api/build/logo/route')

    const res = await POST(multipartRequest('http://localhost/api/build/logo', { companyId: 'acme' }))

    expect(res.status).toBe(404)
  })

  // #832-class bug: a transient registry-read failure must never be presented
  // as a confident "company not found" to a real owner uploading their logo.
  it('returns 503 lookup_failed when the registry read itself fails (NOT a false 404)', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    appRegistry.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const { POST } = await import('@/app/api/build/logo/route')

    const res = await POST(multipartRequest('http://localhost/api/build/logo', { companyId: 'acme' }))

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('lookup_failed')
  })

  it('returns 403 when the signed-in account does not own the company', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    appRegistry.resolveAppVerified.mockResolvedValue(verified({ ownerEmail: 'someone-else@x.com' }))
    const { POST } = await import('@/app/api/build/logo/route')

    const res = await POST(multipartRequest('http://localhost/api/build/logo', { companyId: 'acme' }))

    expect(res.status).toBe(403)
  })

  it('returns 400 when no file is attached', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    appRegistry.resolveAppVerified.mockResolvedValue(verified({ ownerEmail: 'founder@x.com' }))
    const { POST } = await import('@/app/api/build/logo/route')

    const res = await POST(multipartRequest('http://localhost/api/build/logo', { companyId: 'acme' }))

    expect(res.status).toBe(400)
  })

  it('returns 400 for an unsupported file type', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    appRegistry.resolveAppVerified.mockResolvedValue(verified({ ownerEmail: 'founder@x.com' }))
    const { POST } = await import('@/app/api/build/logo/route')

    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' })
    const res = await POST(multipartRequest('http://localhost/api/build/logo', { companyId: 'acme', file }))

    expect(res.status).toBe(400)
  })

  it('returns 502 when the storage upload fails', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    appRegistry.resolveAppVerified.mockResolvedValue(verified({ ownerEmail: 'founder@x.com' }))
    mediaSchedule.uploadMediaFile.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/logo/route')

    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' })
    const res = await POST(multipartRequest('http://localhost/api/build/logo', { companyId: 'acme', file }))

    expect(res.status).toBe(502)
  })

  it('uploads the logo and persists it on the company, returning the url', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    appRegistry.resolveAppVerified.mockResolvedValue(verified({ ownerEmail: 'founder@x.com' }))
    mediaSchedule.uploadMediaFile.mockResolvedValue('file-id-123')
    appRegistry.setAppLogo.mockResolvedValue(true)
    const { POST } = await import('@/app/api/build/logo/route')

    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' })
    const res = await POST(multipartRequest('http://localhost/api/build/logo', { companyId: 'acme', file }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toContain('file-id-123')
    expect(body.saved).toBe(true)
  })
})
