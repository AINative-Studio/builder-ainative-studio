import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1202 (Coverage Phase 2 follow-up) — app/api/build/media/route.ts (#54) and
 * app/api/build/media/upload/route.ts (#323) had zero route-level coverage.
 * All real I/O (auth, media-schedule storage/generation) is mocked.
 */

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: auth.auth }))

const chatStore = vi.hoisted(() => ({
  deriveOwnerKey: vi.fn(() => 'founder@x.com'),
  chatScopeKey: vi.fn((owner: string, slug: string) => `${owner}:${slug}`),
}))
vi.mock('@/lib/build/chat-store', () => chatStore)

const mediaSchedule = vi.hoisted(() => ({
  saveRoutine: vi.fn(),
  listMedia: vi.fn(),
  runMediaGeneration: vi.fn(),
  nextRunAt: vi.fn(() => '2026-10-23T00:00:00.000Z'),
  mediaGenerationConfigured: vi.fn(() => true),
  normalizeMediaKind: vi.fn((v: unknown) => (v === 'video' ? 'video' : 'image')),
  normalizeFrequency: vi.fn((v: unknown) => (v === 'weekly' ? 'weekly' : 'once')),
  saveAsset: vi.fn(),
  uploadMediaFile: vi.fn(),
  fetchFileDownload: vi.fn(),
}))
vi.mock('@/lib/build/media-schedule', () => mediaSchedule)

vi.mock('@/lib/build/media-upload', () => ({
  validateUpload: vi.fn((input: { type?: string }) =>
    input.type === 'image/png'
      ? { ok: true, contentType: 'image/png', fileName: 'photo.png' }
      : { ok: false, error: 'unsupported_type', message: 'bad type' }
  ),
  buildUploadKey: vi.fn(() => 'uploads/scope/photo.png'),
  uploadedAssetUrl: vi.fn((id: string) => `https://bucket/${id}`),
  isFileId: vi.fn((v: unknown) => /^[0-9a-f-]{10,}$/.test(String(v))),
  ALLOWED_IMAGE_TYPES: { 'image/png': 'png' },
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  UPLOAD_PROVIDER: 'upload',
}))

import { mockGetRequest, mockJsonRequest } from '../helpers/api-route-harness'

function multipartRequest(url: string, fields: Record<string, string | Blob>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v as any)
  return new NextRequest(url, { method: 'POST', body: form as any })
}

beforeEach(() => {
  vi.clearAllMocks()
  chatStore.deriveOwnerKey.mockReturnValue('founder@x.com')
  chatStore.chatScopeKey.mockImplementation((owner: string, slug: string) => `${owner}:${slug}`)
  mediaSchedule.mediaGenerationConfigured.mockReturnValue(true)
  mediaSchedule.normalizeMediaKind.mockImplementation((v: unknown) => (v === 'video' ? 'video' : 'image'))
  mediaSchedule.normalizeFrequency.mockImplementation((v: unknown) => (v === 'weekly' ? 'weekly' : 'once'))
})

describe('#1202 GET /api/build/media', () => {
  it('returns empty collections when companyId is missing', async () => {
    const { GET } = await import('@/app/api/build/media/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/media'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ routines: [], assets: [], configured: true, nextRuns: {} })
  })

  it('returns routines/assets with computed next-run times', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    mediaSchedule.listMedia.mockResolvedValue({
      routines: [{ mediaKind: 'image', frequency: 'weekly', enabled: true, lastRunAt: null }],
      assets: [{ id: 'a1' }],
    })
    const { GET } = await import('@/app/api/build/media/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/media?companyId=acme'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.routines).toHaveLength(1)
    expect(body.nextRuns.image).toBe('2026-10-23T00:00:00.000Z')
  })

  it('degrades to empty collections when the store throws', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    mediaSchedule.listMedia.mockRejectedValue(new Error('zerodb down'))
    const { GET } = await import('@/app/api/build/media/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/media?companyId=acme'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.routines).toEqual([])
    expect(body.assets).toEqual([])
  })
})

describe('#1202 POST /api/build/media', () => {
  it('returns 400 when companyId is missing', async () => {
    const { POST } = await import('@/app/api/build/media/route')

    const res = await POST(mockJsonRequest('http://localhost/api/build/media', {}))

    expect(res.status).toBe(400)
  })

  it('schedules a routine by default', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    mediaSchedule.saveRoutine.mockResolvedValue({ mediaKind: 'image', frequency: 'weekly', enabled: true })
    const { POST } = await import('@/app/api/build/media/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/media', { companyId: 'acme', mediaKind: 'image', frequency: 'weekly' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.routine.frequency).toBe('weekly')
    expect(body.configured).toBe(true)
  })

  it('returns 502 when scheduling fails', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    mediaSchedule.saveRoutine.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/media/route')

    const res = await POST(mockJsonRequest('http://localhost/api/build/media', { companyId: 'acme' }))

    expect(res.status).toBe(502)
  })

  it('triggers an immediate generation for action=generate', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    mediaSchedule.runMediaGeneration.mockResolvedValue({ status: 'ok', asset: { id: 'a1' } })
    const { POST } = await import('@/app/api/build/media/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/media', {
        companyId: 'acme',
        action: 'generate',
        mediaKind: 'image',
        brand: { companyName: 'Acme', idea: 'coffee finder' },
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(mediaSchedule.runMediaGeneration).toHaveBeenCalledWith(
      'founder@x.com:acme',
      'image',
      expect.objectContaining({ companyName: 'Acme', idea: 'coffee finder' })
    )
  })

  it('reports disabled when generation is not configured', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    mediaSchedule.runMediaGeneration.mockResolvedValue({ status: 'disabled' })
    const { POST } = await import('@/app/api/build/media/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/media', { companyId: 'acme', action: 'generate' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('disabled')
  })
})

describe('#1202 POST /api/build/media/upload', () => {
  it('returns 401 with no signed-in session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/media/upload/route')

    const res = await POST(multipartRequest('http://localhost/api/build/media/upload', { companyId: 'acme' }))

    expect(res.status).toBe(401)
  })

  it('returns 401 for a guest session', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'guest@x.com', type: 'guest' } })
    const { POST } = await import('@/app/api/build/media/upload/route')

    const res = await POST(multipartRequest('http://localhost/api/build/media/upload', { companyId: 'acme' }))

    expect(res.status).toBe(401)
  })

  it('returns 400 when companyId is missing', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    const { POST } = await import('@/app/api/build/media/upload/route')

    const res = await POST(multipartRequest('http://localhost/api/build/media/upload', {}))

    expect(res.status).toBe(400)
  })

  it('returns 400 when no file is attached', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    const { POST } = await import('@/app/api/build/media/upload/route')

    const res = await POST(multipartRequest('http://localhost/api/build/media/upload', { companyId: 'acme' }))

    expect(res.status).toBe(400)
  })

  it('returns 400 for an unsupported file type', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    const { POST } = await import('@/app/api/build/media/upload/route')

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const res = await POST(
      multipartRequest('http://localhost/api/build/media/upload', { companyId: 'acme', file })
    )

    expect(res.status).toBe(400)
  })

  it('returns 502 when the storage upload fails', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    mediaSchedule.uploadMediaFile.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/media/upload/route')

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
    const res = await POST(
      multipartRequest('http://localhost/api/build/media/upload', { companyId: 'acme', file })
    )

    expect(res.status).toBe(502)
  })

  it('uploads the photo and saves an asset row, returning the url', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    mediaSchedule.uploadMediaFile.mockResolvedValue('file-id-456')
    mediaSchedule.saveAsset.mockResolvedValue({ id: 'asset-1', url: 'https://bucket/file-id-456' })
    const { POST } = await import('@/app/api/build/media/upload/route')

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
    const res = await POST(
      multipartRequest('http://localhost/api/build/media/upload', { companyId: 'acme', file })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toContain('file-id-456')
    expect(body.saved).toBe(true)
  })

  it('still returns the url when the asset row write fails', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    mediaSchedule.uploadMediaFile.mockResolvedValue('file-id-789')
    mediaSchedule.saveAsset.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/media/upload/route')

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
    const res = await POST(
      multipartRequest('http://localhost/api/build/media/upload', { companyId: 'acme', file })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.saved).toBe(false)
  })
})

describe('#1202 GET /api/build/media/upload', () => {
  it('returns 400 for a malformed file id', async () => {
    const { GET } = await import('@/app/api/build/media/upload/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/media/upload?id=bad'))

    expect(res.status).toBe(400)
  })

  it('returns 404 when the file id does not resolve', async () => {
    mediaSchedule.fetchFileDownload.mockResolvedValue(null)
    const { GET } = await import('@/app/api/build/media/upload/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/media/upload?id=0123456789abcdef'))

    expect(res.status).toBe(404)
  })

  it('returns 415 for an unsupported stored content type', async () => {
    mediaSchedule.fetchFileDownload.mockResolvedValue({ url: 'https://bucket/x', contentType: 'application/pdf' })
    const { GET } = await import('@/app/api/build/media/upload/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/media/upload?id=0123456789abcdef'))

    expect(res.status).toBe(415)
  })

  it('302-redirects to a fresh presigned url', async () => {
    mediaSchedule.fetchFileDownload.mockResolvedValue({ url: 'https://bucket/photo.png', contentType: 'image/png' })
    const { GET } = await import('@/app/api/build/media/upload/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/media/upload?id=0123456789abcdef'))

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://bucket/photo.png')
  })
})
