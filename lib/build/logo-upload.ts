/**
 * Logo / brand asset upload (#492) — the PURE core behind "upload your own logo"
 * on the Live dashboard's Website panel.
 *
 * WHY: #491 fixed Cody's chat lying about a logo-editing workflow that didn't
 * exist; #492 is the real underlying gap — there was NO way for a founder to
 * upload their own logo anywhere in the product. Auto Media (#54/#323) lets a
 * founder upload general photos into a shared library, but nothing marks one as
 * THE company logo, and nothing persists a durable "this is our brand mark" —
 * every page reload of the dashboard forgot it.
 *
 * This module is the same split as media-upload.ts (the sibling Auto Media
 * upload core): validation, sanitization, storage-key + serve-url shaping live
 * here, pure and unit-testable without a network. The route
 * (app/api/build/logo/route.ts) does the I/O — bytes to the SAME ZeroDB files
 * bucket Auto Media already uses (uploadMediaFile in media-schedule.ts) — and
 * app-registry.ts's setAppLogo persists the durable logoUrl on the company
 * record itself (not just a media-library row), so it survives dashboard
 * reloads and is available to anything that reads AppEntry.
 *
 * SCOPE (documented honestly — see #492 PR): this ships upload → durable
 * storage → persisted brand asset → founder-visible confirmation. It does NOT
 * wire the uploaded logo into an ALREADY-DEPLOYED company's live generated
 * site — that site is arbitrary LLM-authored code sitting in the company's own
 * Gitea repo, and the only existing mechanism to push changes there
 * (commitRegeneration in lib/git/company-repo.ts) requires a full, valid
 * regenerated FileMap (an App.tsx/entry file must be present in the SAME call),
 * not a single-file patch. Building a safe "patch one file into an arbitrary
 * existing repo" primitive is real, separate infra work — attempting it here
 * would risk silently corrupting or reverting a founder's live site, which is
 * worse than not shipping the "apply to live site" half yet.
 */

/** Max accepted upload size — 2MB. A logo is a small brand mark, not a photo;
 *  keeping the ceiling tight discourages founders from uploading a full-size
 *  banner/hero image here (that's what Auto Media's photo upload is for). */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

/** The provider tag that marks a build_media row as the founder's logo (vs a
 *  general uploaded photo or Cody-generated asset). Distinct from Auto Media's
 *  UPLOAD_PROVIDER so a logo never gets mixed into the general photo library. */
export const LOGO_PROVIDER = 'logo'

/** Canonical accepted image MIME types → their file extension. SVG is included
 *  (common for vector logos) alongside the raster formats Auto Media accepts. */
export const ALLOWED_LOGO_TYPES: Record<string, string> = {
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

/** The `accept` attribute for the upload input — one source of truth. */
export const LOGO_ACCEPT_ATTR = Object.keys(ALLOWED_LOGO_TYPES).join(',')

export type LogoRejection = 'no_file' | 'unsupported_type' | 'too_large' | 'empty_file'

export type LogoValidation =
  | { ok: true; contentType: string; ext: string; fileName: string }
  | { ok: false; error: LogoRejection; message: string }

/** Honest, first-person copy for each rejection — shown verbatim in the panel. */
export const LOGO_REJECTION_MESSAGES: Record<LogoRejection, string> = {
  no_file: 'I didn’t receive a file — pick a logo image and try again.',
  unsupported_type: 'I can take PNG, JPG, WebP or SVG images — that file is a different type.',
  too_large: 'That logo is over 2MB — export a smaller version and try again.',
  empty_file: 'That file is empty — pick an image with actual content.',
}

/**
 * Resolve the canonical accepted MIME type for a logo upload from its reported
 * MIME and/or file name. Falls back to the extension when the browser reports
 * a blank or generic type. Returns null when the file is not an accepted image.
 */
export function normalizeLogoType(mime: unknown, fileName: unknown): string | null {
  const m = String(mime || '').toLowerCase().trim()
  if (m in ALLOWED_LOGO_TYPES) return m
  if (m === 'image/jpg') return 'image/jpeg' // common non-canonical alias
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
 * Validate a logo upload candidate (name / reported type / byte size): images
 * only (png/jpg/jpeg/webp/svg) and at most 2MB. Pure — the route runs it
 * against the parsed multipart file; the panel runs the SAME function
 * client-side before spending the network round-trip.
 */
export function validateLogoUpload(input: {
  name?: unknown
  type?: unknown
  size?: unknown
}): LogoValidation {
  const size = Number(input?.size)
  if (!Number.isFinite(size) || (!input?.name && !input?.type)) {
    return { ok: false, error: 'no_file', message: LOGO_REJECTION_MESSAGES.no_file }
  }
  const contentType = normalizeLogoType(input.type, input.name)
  if (!contentType) {
    return { ok: false, error: 'unsupported_type', message: LOGO_REJECTION_MESSAGES.unsupported_type }
  }
  if (size <= 0) {
    return { ok: false, error: 'empty_file', message: LOGO_REJECTION_MESSAGES.empty_file }
  }
  if (size > MAX_LOGO_BYTES) {
    return { ok: false, error: 'too_large', message: LOGO_REJECTION_MESSAGES.too_large }
  }
  return {
    ok: true,
    contentType,
    ext: ALLOWED_LOGO_TYPES[contentType],
    fileName: sanitizeFileName(input.name, ALLOWED_LOGO_TYPES[contentType]),
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
  return `${base || 'logo'}.${ext || 'png'}`
}

/**
 * The storage key a logo lands under in the ZeroDB files bucket:
 * logos/{scope-hash}/{timestamp}-{sanitized-name}. Distinct top-level prefix
 * from Auto Media's uploads/ so the two are trivially distinguishable in the
 * bucket even though they share the same files API.
 */
export function buildLogoKey(scopeKey: string, fileName: string, now: Date = new Date()): string {
  return `logos/${hashScope(scopeKey)}/${now.getTime().toString(36)}-${fileName}`
}

/** Stable short hash of the scope key (djb2 → base36). Pure and deterministic. */
export function hashScope(scopeKey: string): string {
  let h = 5381
  const s = String(scopeKey || '')
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Is a string a plausible ZeroDB file id (UUID)? Guards the serve route. */
export function isFileId(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

/**
 * The durable URL an uploaded logo is referenced by — our own serve route,
 * which redirects to a fresh presigned bucket URL on every request (bucket
 * presigns expire; this URL does not). Relative, so it works in the dashboard
 * and anywhere else the same origin can reference it.
 */
export function logoAssetUrl(fileId: string): string {
  return `/api/build/logo?id=${encodeURIComponent(String(fileId || '').trim())}`
}

/** Tolerant file-id extraction from the ZeroDB files upload response. */
export function extractFileId(response: unknown): string {
  const r = response as any
  const candidate = r?.file_id || r?.fileId || r?.id || r?.minio_result?.file_id || ''
  return isFileId(candidate) ? String(candidate) : ''
}
