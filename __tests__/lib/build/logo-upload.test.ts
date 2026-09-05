import { describe, it, expect } from 'vitest'
import {
  MAX_LOGO_BYTES,
  LOGO_PROVIDER,
  ALLOWED_LOGO_TYPES,
  LOGO_ACCEPT_ATTR,
  LOGO_REJECTION_MESSAGES,
  normalizeLogoType,
  extensionOf,
  validateLogoUpload,
  sanitizeFileName,
  buildLogoKey,
  hashScope,
  isFileId,
  logoAssetUrl,
  extractFileId,
} from '@/lib/build/logo-upload'

/**
 * #492 — upload-your-own-logo. Covers the pure validation/shaping core (type +
 * size rules, sanitization, storage key, serve url, response extraction), the
 * SAME split as media-upload.ts's tests. No network is touched.
 */

describe('logo-upload vocabulary', () => {
  it('caps uploads at 2MB — tighter than Auto Media photos (a logo is a small mark)', () => {
    expect(MAX_LOGO_BYTES).toBe(2 * 1024 * 1024)
  })

  it('accepts exactly png / jpeg / webp / svg', () => {
    expect(Object.keys(ALLOWED_LOGO_TYPES).sort()).toEqual(
      ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'].sort(),
    )
  })

  it('derives the file-input accept attribute from the allowed types', () => {
    for (const mime of Object.keys(ALLOWED_LOGO_TYPES)) {
      expect(LOGO_ACCEPT_ATTR).toContain(mime)
    }
  })

  it('tags a logo with its own provider, distinct from Auto Media uploads', () => {
    expect(LOGO_PROVIDER).toBe('logo')
  })
})

describe('normalizeLogoType', () => {
  it('passes through canonical accepted types', () => {
    expect(normalizeLogoType('image/png', 'a.png')).toBe('image/png')
    expect(normalizeLogoType('image/jpeg', 'a.jpg')).toBe('image/jpeg')
    expect(normalizeLogoType('image/webp', 'a.webp')).toBe('image/webp')
    expect(normalizeLogoType('image/svg+xml', 'a.svg')).toBe('image/svg+xml')
  })

  it('canonicalizes the common image/jpg alias', () => {
    expect(normalizeLogoType('image/jpg', 'a.jpg')).toBe('image/jpeg')
  })

  it('normalizes case and whitespace', () => {
    expect(normalizeLogoType(' IMAGE/PNG ', 'a.png')).toBe('image/png')
  })

  it('falls back to the extension for blank or generic types', () => {
    expect(normalizeLogoType('', 'mark.jpeg')).toBe('image/jpeg')
    expect(normalizeLogoType('', 'mark.JPG')).toBe('image/jpeg')
    expect(normalizeLogoType('application/octet-stream', 'logo.svg')).toBe('image/svg+xml')
    expect(normalizeLogoType(undefined, 'shot.webp')).toBe('image/webp')
  })

  it('rejects non-image and unknown types', () => {
    expect(normalizeLogoType('image/gif', 'a.gif')).toBeNull()
    expect(normalizeLogoType('application/pdf', 'a.pdf')).toBeNull()
    expect(normalizeLogoType('', 'notes.txt')).toBeNull()
    expect(normalizeLogoType('', 'noextension')).toBeNull()
    // A concrete (non-generic) wrong type is NOT overridden by the extension.
    expect(normalizeLogoType('application/pdf', 'sneaky.png')).toBeNull()
  })
})

describe('extensionOf', () => {
  it('extracts a lowercased extension', () => {
    expect(extensionOf('Logo.PNG')).toBe('png')
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

describe('validateLogoUpload', () => {
  it('accepts a normal logo and returns canonical type + sanitized name', () => {
    const v = validateLogoUpload({ name: 'Company Logo.PNG', type: 'image/png', size: 1024 })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.contentType).toBe('image/png')
      expect(v.ext).toBe('png')
      expect(v.fileName).toBe('company-logo.png')
    }
  })

  it('accepts an SVG mark', () => {
    const v = validateLogoUpload({ name: 'mark.svg', type: 'image/svg+xml', size: 2048 })
    expect(v).toMatchObject({ ok: true, contentType: 'image/svg+xml', ext: 'svg' })
  })

  it('accepts a file at exactly the 2MB ceiling', () => {
    expect(validateLogoUpload({ name: 'a.jpg', type: 'image/jpeg', size: MAX_LOGO_BYTES }).ok).toBe(true)
  })

  it('rejects a file over 2MB with the honest message', () => {
    const v = validateLogoUpload({ name: 'a.jpg', type: 'image/jpeg', size: MAX_LOGO_BYTES + 1 })
    expect(v).toMatchObject({ ok: false, error: 'too_large', message: LOGO_REJECTION_MESSAGES.too_large })
  })

  it('rejects unsupported types (gif, pdf, unknown)', () => {
    for (const [name, type] of [['a.gif', 'image/gif'], ['a.pdf', 'application/pdf'], ['a.txt', '']] as const) {
      const v = validateLogoUpload({ name, type, size: 100 })
      expect(v).toMatchObject({ ok: false, error: 'unsupported_type' })
    }
  })

  it('rejects empty files', () => {
    const v = validateLogoUpload({ name: 'a.png', type: 'image/png', size: 0 })
    expect(v).toMatchObject({ ok: false, error: 'empty_file' })
  })

  it('rejects a missing file (no name/type or non-numeric size)', () => {
    expect(validateLogoUpload({})).toMatchObject({ ok: false, error: 'no_file' })
    expect(validateLogoUpload({ name: 'a.png', type: 'image/png', size: 'nope' })).toMatchObject({ ok: false, error: 'no_file' })
  })

  it('every rejection carries a human message', () => {
    for (const msg of Object.values(LOGO_REJECTION_MESSAGES)) {
      expect(msg.length).toBeGreaterThan(10)
      expect(msg).not.toMatch(/!/) // no exclamation points in Cody's voice
    }
  })
})

describe('sanitizeFileName', () => {
  it('strips path components (posix and windows)', () => {
    expect(sanitizeFileName('/etc/passwd/logo.png', 'png')).toBe('logo.png')
    expect(sanitizeFileName('C:\\Users\\me\\Pics\\logo.png', 'png')).toBe('logo.png')
  })

  it('collapses unsafe characters and enforces the canonical extension', () => {
    expect(sanitizeFileName('My Logo (final)!!.jpeg', 'jpg')).toBe('my-logo-final.jpg')
    expect(sanitizeFileName('café mark.PNG', 'png')).toBe('caf-mark.png')
  })

  it('never returns an empty base name', () => {
    expect(sanitizeFileName('', 'png')).toBe('logo.png')
    expect(sanitizeFileName('....', 'webp')).toBe('logo.webp')
    expect(sanitizeFileName(undefined, '')).toBe('logo.png')
  })

  it('caps very long names', () => {
    const out = sanitizeFileName(`${'x'.repeat(200)}.png`, 'png')
    expect(out.length).toBeLessThanOrEqual(64)
    expect(out.endsWith('.png')).toBe(true)
  })
})

describe('buildLogoKey / hashScope', () => {
  it('is deterministic for a fixed scope + time', () => {
    const at = new Date('2026-08-26T12:00:00Z')
    const a = buildLogoKey('toby@ainative.studio::acme', 'mark.png', at)
    const b = buildLogoKey('toby@ainative.studio::acme', 'mark.png', at)
    expect(a).toBe(b)
    expect(a).toMatch(/^logos\/[a-z0-9]+\/[a-z0-9]+-mark\.png$/)
  })

  it('uses a distinct top-level prefix from Auto Media uploads', () => {
    const a = buildLogoKey('toby@ainative.studio::acme', 'mark.png', new Date())
    expect(a.startsWith('logos/')).toBe(true)
    expect(a.startsWith('uploads/')).toBe(false)
  })

  it('separates different owners into different folders', () => {
    const at = new Date('2026-08-26T12:00:00Z')
    const a = buildLogoKey('a@x.com::acme', 'mark.png', at)
    const b = buildLogoKey('b@y.com::acme', 'mark.png', at)
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

  it('logoAssetUrl points at the durable logo serve route', () => {
    expect(logoAssetUrl('bca483b8-8c88-46a7-b226-bcfedf3c8a15')).toBe(
      '/api/build/logo?id=bca483b8-8c88-46a7-b226-bcfedf3c8a15',
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
})
