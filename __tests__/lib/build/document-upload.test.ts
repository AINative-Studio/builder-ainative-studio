import { describe, it, expect } from 'vitest'
import {
  MAX_DOCUMENT_UPLOAD_BYTES,
  UPLOADED_DOC_TYPE,
  ALLOWED_DOCUMENT_TYPES,
  DOCUMENT_UPLOAD_ACCEPT_ATTR,
  DOCUMENT_UPLOAD_REJECTION_MESSAGES,
  normalizeDocumentType,
  extensionOf,
  validateDocumentUpload,
  sanitizeFileName,
  buildDocumentUploadKey,
  hashScope,
  isDocumentFileId,
  uploadedDocumentUrl,
  extractDocumentFileId,
  documentRowForUpload,
} from '@/lib/build/document-upload'

/**
 * #399 — upload a reference document. Pure validation/shaping core, mirroring
 * media-upload.test.ts's coverage shape for the document-specific rules (larger
 * size ceiling, document MIME types instead of image types).
 */

describe('document-upload vocabulary', () => {
  it('caps uploads at 10MB', () => {
    expect(MAX_DOCUMENT_UPLOAD_BYTES).toBe(10 * 1024 * 1024)
  })

  it('accepts pdf / txt / md / docx / doc / csv', () => {
    expect(Object.keys(ALLOWED_DOCUMENT_TYPES).sort()).toEqual(
      [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'text/csv',
      ].sort(),
    )
  })

  it('derives the file-input accept attribute from the allowed types', () => {
    for (const mime of Object.keys(ALLOWED_DOCUMENT_TYPES)) {
      expect(DOCUMENT_UPLOAD_ACCEPT_ATTR).toContain(mime)
    }
  })

  it('tags an uploaded document with the note DocType, distinct from generated docs', () => {
    expect(UPLOADED_DOC_TYPE).toBe('note')
  })
})

describe('normalizeDocumentType', () => {
  it('passes through canonical accepted types', () => {
    expect(normalizeDocumentType('application/pdf', 'a.pdf')).toBe('application/pdf')
    expect(normalizeDocumentType('text/plain', 'a.txt')).toBe('text/plain')
    expect(normalizeDocumentType('text/csv', 'a.csv')).toBe('text/csv')
  })

  it('falls back to the extension when the reported type is blank (common for .md)', () => {
    expect(normalizeDocumentType('', 'notes.md')).toBe('text/markdown')
    expect(normalizeDocumentType(undefined, 'notes.md')).toBe('text/markdown')
  })

  it('falls back to the extension for a generic octet-stream type', () => {
    expect(normalizeDocumentType('application/octet-stream', 'report.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })

  it('rejects an unsupported type with no recognizable extension', () => {
    expect(normalizeDocumentType('application/zip', 'archive.zip')).toBeNull()
  })

  it('rejects when both type and extension are missing/unrecognized', () => {
    expect(normalizeDocumentType('', 'noext')).toBeNull()
  })
})

describe('extensionOf', () => {
  it('extracts a lowercased extension', () => {
    expect(extensionOf('Report.PDF')).toBe('pdf')
  })
  it('returns empty for no extension', () => {
    expect(extensionOf('README')).toBe('')
  })
  it('returns empty for a dotfile with nothing after the dot', () => {
    expect(extensionOf('file.')).toBe('')
  })
  it('returns empty for a leading-dot-only name', () => {
    expect(extensionOf('.gitignore')).toBe('')
  })
})

describe('validateDocumentUpload', () => {
  it('accepts a valid pdf', () => {
    const result = validateDocumentUpload({ name: 'brief.pdf', type: 'application/pdf', size: 1024 })
    expect(result).toEqual({ ok: true, contentType: 'application/pdf', ext: 'pdf', fileName: 'brief.pdf' })
  })

  it('rejects when no file info is present at all', () => {
    const result = validateDocumentUpload({ size: NaN })
    expect(result).toEqual({ ok: false, error: 'no_file', message: DOCUMENT_UPLOAD_REJECTION_MESSAGES.no_file })
  })

  it('rejects an unsupported type', () => {
    const result = validateDocumentUpload({ name: 'archive.zip', type: 'application/zip', size: 1024 })
    expect(result).toEqual({ ok: false, error: 'unsupported_type', message: DOCUMENT_UPLOAD_REJECTION_MESSAGES.unsupported_type })
  })

  it('rejects a zero-byte file', () => {
    const result = validateDocumentUpload({ name: 'empty.txt', type: 'text/plain', size: 0 })
    expect(result).toEqual({ ok: false, error: 'empty_file', message: DOCUMENT_UPLOAD_REJECTION_MESSAGES.empty_file })
  })

  it('rejects a file over the 10MB ceiling', () => {
    const result = validateDocumentUpload({ name: 'huge.pdf', type: 'application/pdf', size: MAX_DOCUMENT_UPLOAD_BYTES + 1 })
    expect(result).toEqual({ ok: false, error: 'too_large', message: DOCUMENT_UPLOAD_REJECTION_MESSAGES.too_large })
  })

  it('accepts a file exactly at the size ceiling', () => {
    const result = validateDocumentUpload({ name: 'ok.pdf', type: 'application/pdf', size: MAX_DOCUMENT_UPLOAD_BYTES })
    expect(result.ok).toBe(true)
  })
})

describe('sanitizeFileName', () => {
  it('strips path components, special chars, and re-appends the canonical extension', () => {
    expect(sanitizeFileName('../../etc/My Report!!.pdf', 'pdf')).toBe('my-report.pdf')
  })
  it('falls back to a default base name when nothing survives sanitization', () => {
    expect(sanitizeFileName('***', 'pdf')).toBe('document.pdf')
  })
  it('truncates an overly long name', () => {
    const long = 'a'.repeat(200) + '.pdf'
    const result = sanitizeFileName(long, 'pdf')
    expect(result.length).toBeLessThanOrEqual(70)
  })
})

describe('buildDocumentUploadKey', () => {
  it('lands under a doc-uploads/ prefix, distinct from media-upload.ts\'s uploads/ prefix', () => {
    const key = buildDocumentUploadKey('owner::acme', 'brief.pdf', new Date(0))
    expect(key.startsWith('doc-uploads/')).toBe(true)
    expect(key).toContain('brief.pdf')
  })

  it('is deterministic for the same scope + time', () => {
    const now = new Date(1700000000000)
    expect(buildDocumentUploadKey('owner::acme', 'a.pdf', now)).toBe(buildDocumentUploadKey('owner::acme', 'a.pdf', now))
  })

  it('differs for two different scope keys (no cross-founder collision)', () => {
    const now = new Date(0)
    expect(buildDocumentUploadKey('owner::acme', 'a.pdf', now)).not.toBe(buildDocumentUploadKey('owner::other', 'a.pdf', now))
  })
})

describe('hashScope', () => {
  it('is deterministic', () => {
    expect(hashScope('owner::acme')).toBe(hashScope('owner::acme'))
  })
  it('differs for different inputs', () => {
    expect(hashScope('owner::acme')).not.toBe(hashScope('owner::other'))
  })
})

describe('isDocumentFileId', () => {
  it('accepts a real UUID', () => {
    expect(isDocumentFileId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })
  it('rejects a non-UUID string', () => {
    expect(isDocumentFileId('not-a-uuid')).toBe(false)
  })
  it('rejects non-string input', () => {
    expect(isDocumentFileId(12345)).toBe(false)
    expect(isDocumentFileId(null)).toBe(false)
  })
})

describe('uploadedDocumentUrl', () => {
  it('builds the serve-route url for a file id', () => {
    expect(uploadedDocumentUrl('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/api/build/documents/upload?id=550e8400-e29b-41d4-a716-446655440000',
    )
  })
})

describe('extractDocumentFileId', () => {
  it('extracts from the common file_id shape', () => {
    expect(extractDocumentFileId({ file_id: '550e8400-e29b-41d4-a716-446655440000' })).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    )
  })
  it('extracts from an alternate id shape', () => {
    expect(extractDocumentFileId({ id: '550e8400-e29b-41d4-a716-446655440000' })).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    )
  })
  it('returns empty string when nothing valid is present', () => {
    expect(extractDocumentFileId({})).toBe('')
    expect(extractDocumentFileId(null)).toBe('')
    expect(extractDocumentFileId({ file_id: 'not-a-uuid' })).toBe('')
  })
})

describe('documentRowForUpload', () => {
  it('builds a title + content reference row for the document-store', () => {
    const result = documentRowForUpload({ fileName: 'brief.pdf', url: '/api/build/documents/upload?id=abc', sizeBytes: 2048 })
    expect(result.title).toBe('brief.pdf')
    expect(result.content).toContain('brief.pdf')
    expect(result.content).toContain('/api/build/documents/upload?id=abc')
    expect(result.content).toContain('2KB')
  })

  it('rounds sub-1KB files up to 1KB rather than showing 0KB', () => {
    const result = documentRowForUpload({ fileName: 'tiny.txt', url: '/x', sizeBytes: 10 })
    expect(result.content).toContain('1KB')
  })
})
