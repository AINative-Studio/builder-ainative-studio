/**
 * Document upload validation + shaping (#399) — the PURE core behind "drop a
 * doc into the workspace".
 *
 * WHY: Cody's own chat responses (app/api/build/ask/route.ts) reference the
 * founder being able to drop reference docs into the workspace, but no upload
 * path existed for anything but images (lib/build/media-upload.ts, PNG/JPG/
 * WebP/SVG only). This module holds the same class of pure, unit-testable
 * decisions for GENERAL documents (PDF/TXT/MD/DOCX) — accepted types, the size
 * ceiling, file-name sanitization, and the storage key an upload lands under —
 * mirroring media-upload.ts's split so the route and (future) panel can share
 * one source of truth without a network round-trip to validate client-side.
 *
 * The actual byte transport reuses media-schedule.ts's uploadMediaFile — that
 * ZeroDB files-API call is already fully generic (any contentType/key), so no
 * new storage transport is needed. The resulting file is referenced from a
 * BuildDocument row (lib/build/document-store.ts) — the founder's REAL,
 * already-listed Documents library — rather than a new table, so an uploaded
 * doc shows up next to Cody's generated Research/Roadmap/Mission entries with
 * no new UI surface required.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Max accepted upload size — 10MB. Docs run larger than the 5MB image ceiling
 *  (media-upload.ts) but still need a real bound. */
export const MAX_DOCUMENT_UPLOAD_BYTES = 10 * 1024 * 1024

/** The DocType (document-store.ts) an uploaded file is filed under — distinct
 *  from Cody's generated 'note' so the two are never conflated in filtering. */
export const UPLOADED_DOC_TYPE = 'note' as const

/** Canonical accepted document MIME types → their file extension. */
export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/csv': 'csv',
}

/** Extension → canonical MIME, for files whose browser-reported type is blank
 *  (common for .md, which browsers rarely assign a MIME to). */
const EXT_TO_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  csv: 'text/csv',
}

/** The `accept` attribute for a file input — one source of truth, mirroring
 *  media-upload.ts's UPLOAD_ACCEPT_ATTR. */
export const DOCUMENT_UPLOAD_ACCEPT_ATTR = Object.keys(ALLOWED_DOCUMENT_TYPES).join(',')

export type DocumentUploadRejection = 'no_file' | 'unsupported_type' | 'too_large' | 'empty_file'

export type DocumentUploadValidation =
  | { ok: true; contentType: string; ext: string; fileName: string }
  | { ok: false; error: DocumentUploadRejection; message: string }

/** Honest, first-person copy for each rejection — mirrors media-upload.ts's tone. */
export const DOCUMENT_UPLOAD_REJECTION_MESSAGES: Record<DocumentUploadRejection, string> = {
  no_file: 'I didn’t receive a file — pick a document and try again.',
  unsupported_type: 'I can take PDF, TXT, MD, DOC, DOCX or CSV files — that file is a different type.',
  too_large: 'That file is over 10MB — trim it down and try again.',
  empty_file: 'That file is empty — pick a document with actual content.',
}

// ---------------------------------------------------------------------------
// Pure validation
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical accepted MIME type for an upload from its reported MIME
 * and/or file name. Falls back to the extension when the browser reports a
 * blank or generic type (common for .md/.csv). Returns null when the file is
 * not an accepted document type.
 */
export function normalizeDocumentType(mime: unknown, fileName: unknown): string | null {
  const m = String(mime || '').toLowerCase().trim()
  if (m in ALLOWED_DOCUMENT_TYPES) return m
  // Blank / generic type → trust the extension.
  if (!m || m === 'application/octet-stream') {
    const ext = extensionOf(fileName)
    if (ext && ext in EXT_TO_TYPE) return EXT_TO_TYPE[ext]
  }
  return null
}

/** Lowercased extension of a file name (no dot), or '' when there is none. */
export function extensionOf(fileName: unknown): string {
  const name = String(fileName || '')
  const idx = name.lastIndexOf('.')
  if (idx <= 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase().trim()
}

/**
 * Validate an upload candidate (name / reported type / byte size) against the
 * accepted-types + 10MB rules. Pure — the route runs it against the parsed
 * multipart file.
 */
export function validateDocumentUpload(input: {
  name?: unknown
  type?: unknown
  size?: unknown
}): DocumentUploadValidation {
  const size = Number(input?.size)
  if (!Number.isFinite(size) || (!input?.name && !input?.type)) {
    return { ok: false, error: 'no_file', message: DOCUMENT_UPLOAD_REJECTION_MESSAGES.no_file }
  }
  const contentType = normalizeDocumentType(input.type, input.name)
  if (!contentType) {
    return { ok: false, error: 'unsupported_type', message: DOCUMENT_UPLOAD_REJECTION_MESSAGES.unsupported_type }
  }
  if (size <= 0) {
    return { ok: false, error: 'empty_file', message: DOCUMENT_UPLOAD_REJECTION_MESSAGES.empty_file }
  }
  if (size > MAX_DOCUMENT_UPLOAD_BYTES) {
    return { ok: false, error: 'too_large', message: DOCUMENT_UPLOAD_REJECTION_MESSAGES.too_large }
  }
  return {
    ok: true,
    contentType,
    ext: ALLOWED_DOCUMENT_TYPES[contentType],
    fileName: sanitizeFileName(input.name, ALLOWED_DOCUMENT_TYPES[contentType]),
  }
}

/**
 * Sanitize a user-supplied file name into a safe storage segment: strips any
 * path, collapses everything outside [a-z0-9._-] and guarantees the canonical
 * extension. Never returns an empty name. Mirrors media-upload.ts exactly.
 */
export function sanitizeFileName(rawName: unknown, ext: string): string {
  const base = String(rawName || '')
    .split(/[\\/]/) // drop any path component
    .pop()!
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '') // drop the extension; we re-append canonically
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return `${base || 'document'}.${ext || 'txt'}`
}

/**
 * The storage key an upload lands under in the ZeroDB files bucket:
 * doc-uploads/{scope-hash}/{timestamp}-{sanitized-name}. A distinct prefix from
 * media-upload.ts's uploads/ so the two never collide, even though both share
 * the same underlying ZeroDB files bucket/API.
 */
export function buildDocumentUploadKey(scopeKey: string, fileName: string, now: Date = new Date()): string {
  return `doc-uploads/${hashScope(scopeKey)}/${now.getTime().toString(36)}-${fileName}`
}

/** Stable short hash of the scope key (djb2 → base36). Identical algorithm to
 *  media-upload.ts's hashScope — same scope key always hashes the same way. */
export function hashScope(scopeKey: string): string {
  let h = 5381
  const s = String(scopeKey || '')
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// ---------------------------------------------------------------------------
// Serve URL + response shaping
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Is a string a plausible ZeroDB file id (UUID)? Guards the serve route. */
export function isDocumentFileId(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

/**
 * The durable URL an uploaded document is referenced by — our own serve
 * route, which redirects to a fresh presigned bucket URL on every request
 * (bucket presigns expire; this URL does not). Mirrors media-upload.ts's
 * uploadedAssetUrl exactly, pointed at the documents route instead.
 */
export function uploadedDocumentUrl(fileId: string): string {
  return `/api/build/documents/upload?id=${encodeURIComponent(String(fileId || '').trim())}`
}

/** Tolerant file-id extraction from the ZeroDB files upload response. Identical
 *  logic to media-upload.ts's extractFileId. */
export function extractDocumentFileId(response: unknown): string {
  const r = response as any
  const candidate = r?.file_id || r?.fileId || r?.id || r?.minio_result?.file_id || ''
  return isDocumentFileId(candidate) ? String(candidate) : ''
}

/**
 * The BuildDocument title + content-body a document-store row gets for an
 * uploaded file. The uploaded file's real bytes live in ZeroDB file storage
 * (referenced by url); the document-store row is a lightweight reference
 * entry so the upload appears in the founder's real Documents library
 * alongside Cody's generated Research/Roadmap/Mission entries.
 */
export function documentRowForUpload(input: { fileName: string; url: string; sizeBytes: number }): {
  title: string
  content: string
} {
  const kb = Math.max(1, Math.round(input.sizeBytes / 1024))
  return {
    title: input.fileName,
    content: `Uploaded reference document: ${input.fileName} (${kb}KB).\n\nFile: ${input.url}`,
  }
}
