/**
 * Media upload validation + shaping (#323 / GR-14) — the PURE core behind
 * "upload your own photos" in the MediaPanel.
 *
 * WHY: the Auto Media pipeline (#54) only produced AI-generated assets. Founders
 * also have real photos — their product, their team, their storefront — that a
 * generated app should be able to reference. This module holds every decision the
 * upload route makes that does NOT require I/O, so the rules are unit-testable
 * without a network (same split as media-schedule.ts):
 *
 *   - which image types are accepted (png / jpg / jpeg / webp / svg)
 *   - the 5MB size ceiling
 *   - file-name sanitization + the storage key an upload lands under
 *   - the durable serve URL an uploaded asset gets ({@link uploadedAssetUrl})
 *   - tolerant extraction of the file id from the ZeroDB files response
 *
 * The actual byte transport (multipart POST to the ZeroDB files API) lives with
 * the rest of the media store I/O in media-schedule.ts ({@link uploadMediaFile});
 * uploaded assets are persisted through the SAME saveAsset/build_media path the
 * generated media already uses — provider 'upload' is what distinguishes "yours"
 * from Cody's.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Max accepted upload size — 5MB, matching the affordance copy in the panel. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** The provider tag that marks an asset as founder-uploaded (vs generated). */
export const UPLOAD_PROVIDER = 'upload'

/** Canonical accepted image MIME types → their file extension. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** Extension → canonical MIME, for files whose browser-reported type is blank. */
const EXT_TO_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** The `accept` attribute for the panel's file input — one source of truth. */
export const UPLOAD_ACCEPT_ATTR = Object.keys(ALLOWED_IMAGE_TYPES).join(',')

export type UploadRejection = 'no_file' | 'unsupported_type' | 'too_large' | 'empty_file'

export type UploadValidation =
  | { ok: true; contentType: string; ext: string; fileName: string }
  | { ok: false; error: UploadRejection; message: string }

/** Honest, first-person copy for each rejection — shown verbatim in the panel. */
export const UPLOAD_REJECTION_MESSAGES: Record<UploadRejection, string> = {
  no_file: 'I didn’t receive a file — pick a photo and try again.',
  unsupported_type: 'I can take PNG, JPG, WebP or SVG images — that file is a different type.',
  too_large: 'That photo is over 5MB — export a smaller version and try again.',
  empty_file: 'That file is empty — pick a photo with actual content.',
}

// ---------------------------------------------------------------------------
// Pure validation
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical accepted MIME type for an upload from its reported MIME
 * and/or file name. Falls back to the extension when the browser reports a blank
 * or generic type. Returns null when the file is not an accepted image.
 */
export function normalizeImageType(mime: unknown, fileName: unknown): string | null {
  const m = String(mime || '').toLowerCase().trim()
  if (m in ALLOWED_IMAGE_TYPES) return m
  if (m === 'image/jpg') return 'image/jpeg' // common non-canonical alias
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
 * GR-14 rules: images only (png/jpg/jpeg/webp/svg) and at most 5MB. Pure — the
 * route runs it against the parsed multipart file; the panel runs the SAME
 * function client-side before spending the network round-trip.
 */
export function validateUpload(input: {
  name?: unknown
  type?: unknown
  size?: unknown
}): UploadValidation {
  const size = Number(input?.size)
  if (!Number.isFinite(size) || (!input?.name && !input?.type)) {
    return { ok: false, error: 'no_file', message: UPLOAD_REJECTION_MESSAGES.no_file }
  }
  const contentType = normalizeImageType(input.type, input.name)
  if (!contentType) {
    return { ok: false, error: 'unsupported_type', message: UPLOAD_REJECTION_MESSAGES.unsupported_type }
  }
  if (size <= 0) {
    return { ok: false, error: 'empty_file', message: UPLOAD_REJECTION_MESSAGES.empty_file }
  }
  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'too_large', message: UPLOAD_REJECTION_MESSAGES.too_large }
  }
  return {
    ok: true,
    contentType,
    ext: ALLOWED_IMAGE_TYPES[contentType],
    fileName: sanitizeFileName(input.name, ALLOWED_IMAGE_TYPES[contentType]),
  }
}

/**
 * Sanitize a user-supplied file name into a safe storage segment: strips any
 * path, collapses everything outside [a-z0-9._-] and guarantees the canonical
 * extension. Never returns an empty name.
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
  return `${base || 'photo'}.${ext || 'png'}`
}

/**
 * The storage key an upload lands under in the ZeroDB files bucket:
 * uploads/{scope-hash}/{timestamp}-{sanitized-name}. The scope hash keeps one
 * founder's files from colliding with (or being enumerable from) another's,
 * while the timestamp keeps repeat uploads of the same photo distinct.
 */
export function buildUploadKey(scopeKey: string, fileName: string, now: Date = new Date()): string {
  return `uploads/${hashScope(scopeKey)}/${now.getTime().toString(36)}-${fileName}`
}

/** Stable short hash of the scope key (djb2 → base36). Pure and deterministic. */
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
export function isFileId(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

/**
 * The durable URL an uploaded asset is referenced by — our own serve route,
 * which redirects to a fresh presigned bucket URL on every request (bucket
 * presigns expire; this URL does not). Relative, so it works in the panel and
 * in same-origin previews alike.
 */
export function uploadedAssetUrl(fileId: string): string {
  return `/api/build/media/upload?id=${encodeURIComponent(String(fileId || '').trim())}`
}

/** Tolerant file-id extraction from the ZeroDB files upload response. */
export function extractFileId(response: unknown): string {
  const r = response as any
  const candidate = r?.file_id || r?.fileId || r?.id || r?.minio_result?.file_id || ''
  return isFileId(candidate) ? String(candidate) : ''
}

/** Is a stored media asset one the founder uploaded (vs one Cody generated)? */
export function isUploadedAsset(asset: { provider?: string | null } | null | undefined): boolean {
  return String(asset?.provider || '').toLowerCase() === UPLOAD_PROVIDER
}
