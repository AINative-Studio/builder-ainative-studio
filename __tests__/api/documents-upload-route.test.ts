import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #399 — POST/GET /api/build/documents/upload. Every I/O collaborator (auth,
 * ZeroDB file storage, document-store) is mocked — no network call is real.
 * Covers: owner-only auth (guest/anonymous rejected), successful upload
 * (validates → stores bytes → files a build_documents reference row →
 * returns the serve url), a storage failure surfacing a real error (never a
 * fabricated success), and the GET serve-redirect path.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  uploadMediaFile: vi.fn(),
  fetchFileDownload: vi.fn(),
  createDocument: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/media-schedule', () => ({
  uploadMediaFile: h.uploadMediaFile,
  fetchFileDownload: h.fetchFileDownload,
}))
vi.mock('@/lib/build/document-store', () => ({ createDocument: h.createDocument }))

import { POST, GET } from '@/app/api/build/documents/upload/route'

function multipartRequest(fields: Record<string, string | File>): NextRequest {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v as any)
  return new NextRequest('http://localhost/api/build/documents/upload', { method: 'POST', body: form })
}

const REAL_USER = { user: { email: 'founder@acme.com', type: 'user' } }
const GUEST = { user: { email: 'guest-abc@example.com', type: 'guest' } }

beforeEach(() => {
  h.auth.mockReset()
  h.uploadMediaFile.mockReset()
  h.fetchFileDownload.mockReset()
  h.createDocument.mockReset()
})

describe('POST /api/build/documents/upload', () => {
  it('rejects an anonymous (no session) request — 401', async () => {
    h.auth.mockResolvedValue(null)
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))
    expect(res.status).toBe(401)
    expect(h.uploadMediaFile).not.toHaveBeenCalled()
  })

  it('rejects a guest session — 401 (a guest scope evaporates; uploads must not)', async () => {
    h.auth.mockResolvedValue(GUEST)
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))
    expect(res.status).toBe(401)
    expect(h.uploadMediaFile).not.toHaveBeenCalled()
  })

  it('rejects a request with no companyId', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const res = await POST(multipartRequest({ file }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('missing_company')
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

  it('a successful upload stores the bytes, files a reference row, and returns the serve url', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    h.uploadMediaFile.mockResolvedValue('550e8400-e29b-41d4-a716-446655440000')
    h.createDocument.mockResolvedValue({ id: 'd_1', title: 'notes.txt' })

    const file = new File(['hello world'], 'notes.txt', { type: 'text/plain' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('/api/build/documents/upload?id=550e8400-e29b-41d4-a716-446655440000')
    expect(body.saved).toBe(true)
    expect(h.uploadMediaFile).toHaveBeenCalledTimes(1)
    expect(h.createDocument).toHaveBeenCalledTimes(1)
    // The reference row is filed under the 'note' DocType, distinct from Cody's
    // generated research/roadmap/mission/market entries.
    expect(h.createDocument.mock.calls[0][1].type).toBe('note')
  })

  it('a storage failure surfaces a real error — never a fabricated success', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    h.uploadMediaFile.mockResolvedValue('') // upload failed, no file id

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('upload_failed')
    expect(h.createDocument).not.toHaveBeenCalled()
  })

  it('a reference-row write failure still returns the real upload url — the file itself is not lost', async () => {
    h.auth.mockResolvedValue(REAL_USER)
    h.uploadMediaFile.mockResolvedValue('550e8400-e29b-41d4-a716-446655440000')
    h.createDocument.mockResolvedValue(null) // row write hiccup

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const res = await POST(multipartRequest({ file, companyId: 'acme' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('/api/build/documents/upload?id=550e8400-e29b-41d4-a716-446655440000')
    expect(body.saved).toBe(false) // honest — the row did NOT save, even though the file did
  })
})

describe('GET /api/build/documents/upload', () => {
  it('rejects a malformed id — 400, never attempts a download call', async () => {
    const req = new NextRequest('http://localhost/api/build/documents/upload?id=not-a-uuid')
    const res = await GET(req)
    expect(res.status).toBe(400)
    expect(h.fetchFileDownload).not.toHaveBeenCalled()
  })

  it('redirects to a fresh presigned url for a real file id', async () => {
    h.fetchFileDownload.mockResolvedValue({ url: 'https://bucket.example.com/presigned-xyz', contentType: 'text/plain' })
    const req = new NextRequest('http://localhost/api/build/documents/upload?id=550e8400-e29b-41d4-a716-446655440000')
    const res = await GET(req)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://bucket.example.com/presigned-xyz')
  })

  it('returns 404, never a fabricated redirect, when the file cannot be found', async () => {
    h.fetchFileDownload.mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/build/documents/upload?id=550e8400-e29b-41d4-a716-446655440000')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })
})
