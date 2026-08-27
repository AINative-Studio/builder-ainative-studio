import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_PROVIDER,
  ALLOWED_IMAGE_TYPES,
  UPLOAD_ACCEPT_ATTR,
  UPLOAD_REJECTION_MESSAGES,
  normalizeImageType,
  extensionOf,
  validateUpload,
  sanitizeFileName,
  buildUploadKey,
  hashScope,
  isFileId,
  uploadedAssetUrl,
  extractFileId,
  isUploadedAsset,
} from '@/lib/build/media-upload'
import { uploadMediaFile, fetchFileDownload } from '@/lib/build/media-schedule'

/**
 * #323 / GR-14 — upload-your-own-photos. Covers the pure validation/shaping core
 * (type + size rules, sanitization, storage key, serve url, response extraction)
 * and the two ZeroDB files I/O helpers in media-schedule by stubbing global.fetch
 * — same strategy as the media-schedule tests. No network is touched.
 */

const OK = (json: unknown) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) })
const ERR = (status = 500) => ({ ok: false, status, json: async () => ({}), text: async () => '' })

describe('media-upload vocabulary', () => {
  it('caps uploads at 5MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024)
  })

  it('accepts exactly png / jpeg / webp / svg', () => {
    expect(Object.keys(ALLOWED_IMAGE_TYPES).sort()).toEqual(
      ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'].sort(),
    )
  })

  it('derives the file-input accept attribute from the allowed types', () => {
    for (const mime of Object.keys(ALLOWED_IMAGE_TYPES)) {
      expect(UPLOAD_ACCEPT_ATTR).toContain(mime)
    }
  })

  it('tags founder uploads with the upload provider', () => {
    expect(UPLOAD_PROVIDER).toBe('upload')
  })
})

describe('normalizeImageType', () => {
  it('passes through canonical accepted types', () => {
    expect(normalizeImageType('image/png', 'a.png')).toBe('image/png')
    expect(normalizeImageType('image/jpeg', 'a.jpg')).toBe('image/jpeg')
    expect(normalizeImageType('image/webp', 'a.webp')).toBe('image/webp')
    expect(normalizeImageType('image/svg+xml', 'a.svg')).toBe('image/svg+xml')
  })

  it('canonicalizes the common image/jpg alias', () => {
    expect(normalizeImageType('image/jpg', 'a.jpg')).toBe('image/jpeg')
  })

  it('normalizes case and whitespace', () => {
    expect(normalizeImageType(' IMAGE/PNG ', 'a.png')).toBe('image/png')
  })

  it('falls back to the extension for blank or generic types', () => {
    expect(normalizeImageType('', 'photo.jpeg')).toBe('image/jpeg')
    expect(normalizeImageType('', 'photo.JPG')).toBe('image/jpeg')
    expect(normalizeImageType('application/octet-stream', 'logo.svg')).toBe('image/svg+xml')
    expect(normalizeImageType(undefined, 'shot.webp')).toBe('image/webp')
  })

  it('rejects non-image and unknown types', () => {
    expect(normalizeImageType('image/gif', 'a.gif')).toBeNull()
    expect(normalizeImageType('application/pdf', 'a.pdf')).toBeNull()
    expect(normalizeImageType('', 'notes.txt')).toBeNull()
    expect(normalizeImageType('', 'noextension')).toBeNull()
    // A concrete (non-generic) wrong type is NOT overridden by the extension.
    expect(normalizeImageType('application/pdf', 'sneaky.png')).toBeNull()
  })
})

describe('extensionOf', () => {
  it('extracts a lowercased extension', () => {
    expect(extensionOf('Photo.PNG')).toBe('png')
    expect(extensionOf('a.b.c.jpeg')).toBe('jpeg')
  })

  it('returns empty for missing / degenerate extensions', () => {
    expect(extensionOf('noext')).toBe('')
    expect(extensionOf('.dotfile')).toBe('')
    expect(extensionOf('trailing.')).toBe('')
    expect(extensionOf('')).toBe('')
    expect(extensionOf(undefined)).toBe('')
  })
})

describe('validateUpload', () => {
  it('accepts a normal photo and returns canonical type + sanitized name', () => {
    const v = validateUpload({ name: 'Team Photo.PNG', type: 'image/png', size: 1024 })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.contentType).toBe('image/png')
      expect(v.ext).toBe('png')
      expect(v.fileName).toBe('team-photo.png')
    }
  })

  it('accepts a file at exactly the 5MB ceiling', () => {
    expect(validateUpload({ name: 'a.jpg', type: 'image/jpeg', size: MAX_UPLOAD_BYTES }).ok).toBe(true)
  })

  it('rejects a file over 5MB with the honest message', () => {
    const v = validateUpload({ name: 'a.jpg', type: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1 })
    expect(v).toMatchObject({ ok: false, error: 'too_large', message: UPLOAD_REJECTION_MESSAGES.too_large })
  })

  it('rejects unsupported types (gif, pdf, unknown)', () => {
    for (const [name, type] of [['a.gif', 'image/gif'], ['a.pdf', 'application/pdf'], ['a.txt', '']] as const) {
      const v = validateUpload({ name, type, size: 100 })
      expect(v).toMatchObject({ ok: false, error: 'unsupported_type' })
    }
  })

  it('rejects empty files', () => {
    const v = validateUpload({ name: 'a.png', type: 'image/png', size: 0 })
    expect(v).toMatchObject({ ok: false, error: 'empty_file' })
  })

  it('rejects a missing file (no name/type or non-numeric size)', () => {
    expect(validateUpload({})).toMatchObject({ ok: false, error: 'no_file' })
    expect(validateUpload({ name: 'a.png', type: 'image/png', size: 'nope' })).toMatchObject({ ok: false, error: 'no_file' })
  })

  it('every rejection carries a human message', () => {
    for (const msg of Object.values(UPLOAD_REJECTION_MESSAGES)) {
      expect(msg.length).toBeGreaterThan(10)
      expect(msg).not.toMatch(/!/) // no exclamation points in Cody's voice
    }
  })
})

describe('sanitizeFileName', () => {
  it('strips path components (posix and windows)', () => {
    expect(sanitizeFileName('/etc/passwd/shot.png', 'png')).toBe('shot.png')
    expect(sanitizeFileName('C:\\Users\\me\\Pics\\shot.png', 'png')).toBe('shot.png')
  })

  it('collapses unsafe characters and enforces the canonical extension', () => {
    expect(sanitizeFileName('My Photo (final)!!.jpeg', 'jpg')).toBe('my-photo-final.jpg')
    expect(sanitizeFileName('café menu.PNG', 'png')).toBe('caf-menu.png')
  })

  it('never returns an empty base name', () => {
    expect(sanitizeFileName('', 'png')).toBe('photo.png')
    expect(sanitizeFileName('....', 'webp')).toBe('photo.webp')
    expect(sanitizeFileName(undefined, '')).toBe('photo.png')
  })

  it('caps very long names', () => {
    const out = sanitizeFileName(`${'x'.repeat(200)}.png`, 'png')
    expect(out.length).toBeLessThanOrEqual(64)
    expect(out.endsWith('.png')).toBe(true)
  })
})

describe('buildUploadKey / hashScope', () => {
  it('is deterministic for a fixed scope + time', () => {
    const at = new Date('2026-08-26T12:00:00Z')
    const a = buildUploadKey('toby@ainative.studio::acme', 'shot.png', at)
    const b = buildUploadKey('toby@ainative.studio::acme', 'shot.png', at)
    expect(a).toBe(b)
    expect(a).toMatch(/^uploads\/[a-z0-9]+\/[a-z0-9]+-shot\.png$/)
  })

  it('separates different owners into different folders', () => {
    const at = new Date('2026-08-26T12:00:00Z')
    const a = buildUploadKey('a@x.com::acme', 'shot.png', at)
    const b = buildUploadKey('b@y.com::acme', 'shot.png', at)
    expect(a).not.toBe(b)
  })

  it('hashScope is stable and never leaks the raw scope', () => {
    const h = hashScope('toby@ainative.studio::acme')
    expect(h).toBe(hashScope('toby@ainative.studio::acme'))
    expect(h).not.toContain('@')
    expect(hashScope('')).toBe(hashScope(''))
  })
})

describe('serve url + response shaping', () => {
  it('isFileId accepts UUIDs only', () => {
    expect(isFileId('bca483b8-8c88-46a7-b226-bcfedf3c8a15')).toBe(true)
    expect(isFileId('BCA483B8-8C88-46A7-B226-BCFEDF3C8A15')).toBe(true)
    expect(isFileId('not-a-uuid')).toBe(false)
    expect(isFileId('../../etc/passwd')).toBe(false)
    expect(isFileId('')).toBe(false)
    expect(isFileId(42 as unknown as string)).toBe(false)
  })

  it('uploadedAssetUrl points at the durable serve route', () => {
    expect(uploadedAssetUrl('bca483b8-8c88-46a7-b226-bcfedf3c8a15')).toBe(
      '/api/build/media/upload?id=bca483b8-8c88-46a7-b226-bcfedf3c8a15',
    )
  })

  it('extractFileId tolerates the observed response shapes', () => {
    const id = 'bca483b8-8c88-46a7-b226-bcfedf3c8a15'
    expect(extractFileId({ file_id: id })).toBe(id)
    expect(extractFileId({ fileId: id })).toBe(id)
    expect(extractFileId({ id })).toBe(id)
    expect(extractFileId({ minio_result: { file_id: id } })).toBe(id)
    expect(extractFileId({ file_id: 'nope' })).toBe('')
    expect(extractFileId(null)).toBe('')
  })

  it('isUploadedAsset keys off the upload provider', () => {
    expect(isUploadedAsset({ provider: 'upload' })).toBe(true)
    expect(isUploadedAsset({ provider: 'UPLOAD' })).toBe(true)
    expect(isUploadedAsset({ provider: 'multimodal' })).toBe(false)
    expect(isUploadedAsset({})).toBe(false)
    expect(isUploadedAsset(null)).toBe(false)
  })
})

describe('ZeroDB files I/O (media-schedule)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uploadMediaFile POSTs multipart to the files endpoint and returns the file id', async () => {
    const fetchMock = vi.fn(async () => OK({ success: true, file_id: 'bca483b8-8c88-46a7-b226-bcfedf3c8a15' }) as any)
    vi.stubGlobal('fetch', fetchMock)
    const id = await uploadMediaFile({
      bytes: new Uint8Array([1, 2, 3]),
      key: 'uploads/abc/1-shot.png',
      contentType: 'image/png',
    })
    expect(id).toBe('bca483b8-8c88-46a7-b226-bcfedf3c8a15')
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(String(url)).toContain('/files/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('uploadMediaFile returns "" on failure or missing input — never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ERR(500) as any))
    expect(await uploadMediaFile({ bytes: new Uint8Array([1]), key: 'k', contentType: 'image/png' })).toBe('')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net down') }))
    expect(await uploadMediaFile({ bytes: new Uint8Array([1]), key: 'k', contentType: 'image/png' })).toBe('')
    expect(await uploadMediaFile({ bytes: new Uint8Array([1]), key: '', contentType: 'image/png' })).toBe('')
  })

  it('fetchFileDownload resolves the presigned url + content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      OK({ download_url: 'https://bucket.example/x?sig=1', content_type: 'image/png' }) as any))
    const d = await fetchFileDownload('bca483b8-8c88-46a7-b226-bcfedf3c8a15')
    expect(d).toEqual({ url: 'https://bucket.example/x?sig=1', contentType: 'image/png' })
  })

  it('fetchFileDownload returns null on failure, missing url, or blank id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ERR(404) as any))
    expect(await fetchFileDownload('bca483b8-8c88-46a7-b226-bcfedf3c8a15')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => OK({}) as any))
    expect(await fetchFileDownload('bca483b8-8c88-46a7-b226-bcfedf3c8a15')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net down') }))
    expect(await fetchFileDownload('bca483b8-8c88-46a7-b226-bcfedf3c8a15')).toBeNull()
    expect(await fetchFileDownload('')).toBeNull()
  })
})
