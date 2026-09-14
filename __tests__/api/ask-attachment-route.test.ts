import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #741 — POST /api/build/ask/attachment: upload a file to share with Cody
 * directly in the chat. Every I/O collaborator (auth, ZeroDB file storage) is
 * mocked — no network call is real. Covers: owner-only auth (guest/anonymous
 * rejected, identical to media/upload's real gate), missing-company
 * rejection, validation reuse (rejects unsupported types before ever
 * touching storage), a successful IMAGE upload and a successful DOCUMENT
 * upload each returning a stable {fileId, url, contentType, fileName}
 * reference, and a storage failure surfacing a real error.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  uploadMediaFile: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/media-schedule', () => ({ uploadMediaFile: h.uploadMediaFile }))

import { POST } from '@/app/api/build/ask/attachment/route'

function multipartRequest(fields: Record<string, string | File>): NextRequest {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v as any)
  return new NextRequest('http://localhost/api/build/ask/attachment', { method: 'POST', body: form })
}

const REAL_USER = { user: { email: 'founder@acme.com', type: 'user' } }
const GUEST = { user: { email: 'guest-abc@example.com', type: 'guest' } }

beforeEach(() => {
  h.auth.mockReset()
  h.uploadMediaFile.mockReset()
})

describe('POST /api/build/ask/attachment', () => {
  it('rejects an anonymous (no session) request — 401', async () => {
    h.auth.mockResolvedValue(null)
    const file = new File(['hello'], 'photo.png', { type: 'image/png' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))
    expect(res.status).toBe(401)
    expect(h.uploadMediaFile).not.toHaveBeenCalled()
  })

  it('rejects a guest session — 401 (a chat attachment is durable company data)', async () => {
    h.auth.mockResolvedValue(GUEST)
    const file = new File(['hello'], 'photo.png', { type: 'image/png' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))
    expect(res.status).toBe(401)
    expect(h.uploadMediaFile).not.toHaveBeenCalled()
  })

  it('rejects a request with no companyId/chatId', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    const file = new File(['hello'], 'photo.png', { type: 'image/png' })
    const res = await POST(multipartRequest({ file }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('missing_company')
  })

  it('accepts chatId as an alternative scope identifier to companyId, matching /api/build/ask precedence', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    h.uploadMediaFile.mockResolvedValue('550e8400-e29b-41d4-a716-446655440000')
    const file = new File(['hello'], 'photo.png', { type: 'image/png' })
    const res = await POST(multipartRequest({ file, chatId: 'thread-1' }))
    expect(res.status).toBe(200)
  })

  it('rejects an unsupported file type before ever touching storage', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    const file = new File(['zzz'], 'archive.zip', { type: 'application/zip' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('unsupported_type')
    expect(h.uploadMediaFile).not.toHaveBeenCalled()
  })

  it('a successful IMAGE upload returns a stable {fileId, url, contentType, fileName} reference', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    h.uploadMediaFile.mockResolvedValue('550e8400-e29b-41d4-a716-446655440000')
    const file = new File(['fake-bytes'], 'photo.png', { type: 'image/png' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fileId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(body.url).toBe('/api/build/media/upload?id=550e8400-e29b-41d4-a716-446655440000')
    expect(body.contentType).toBe('image/png')
    expect(body.fileName).toBe('photo.png')
  })

  it('a successful DOCUMENT upload returns the documents serve url, not the media one', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    h.uploadMediaFile.mockResolvedValue('550e8400-e29b-41d4-a716-446655440000')
    const file = new File(['fake-bytes'], 'brief.pdf', { type: 'application/pdf' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fileId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(body.url).toBe('/api/build/documents/upload?id=550e8400-e29b-41d4-a716-446655440000')
    expect(body.contentType).toBe('application/pdf')
  })

  it('a storage failure surfaces a real error — never a fabricated success', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    h.uploadMediaFile.mockResolvedValue('') // upload failed, no file id
    const file = new File(['hello'], 'photo.png', { type: 'image/png' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('upload_failed')
  })

  it('scopes the storage key distinctly from the Media/Documents panel uploads (chat- prefix)', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    h.uploadMediaFile.mockResolvedValue('550e8400-e29b-41d4-a716-446655440000')
    const file = new File(['hello'], 'photo.png', { type: 'image/png' })
    await POST(multipartRequest({ file, companyId: 'acme' }))
    expect(h.uploadMediaFile).toHaveBeenCalledTimes(1)
    const key = h.uploadMediaFile.mock.calls[0][0].key
    expect(key).toMatch(/^chat-uploads\//)
  })
})
