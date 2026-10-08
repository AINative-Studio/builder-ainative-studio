/**
 * Auto-media schedule + generation store (#54) — the company's recurring, on-brand
 * media (image + video) routine and the generated assets it produces.
 *
 * WHY: Polsia's company dashboard auto-generates on-brand media on a recurring
 * schedule (two parallel modals: Auto Image + Auto Video, each with a frequency of
 * ONCE / DAILY / WEEKLY / MONTHLY). Builder had no auto-generated on-brand media
 * capability. AINative already OWNS the primitives Polsia resells as a black box —
 * Multimodal Generation (image/video) + Content-Workflow — so we can run this on
 * infra the user owns, with the generated assets stored in the company's own
 * ZeroDB/storage.
 *
 * This module backs:
 *   1. A per-{owner, company} MEDIA ROUTINE (kind='image'|'video', frequency,
 *      enabled, lastRunAt) persisted to ZeroDB `build_media` (kind='routine').
 *   2. The GENERATED MEDIA ASSETS (kind='asset', url, prompt, mediaKind) also in
 *      `build_media`, owned by the company.
 *
 * SAFETY GATE (#54 req 6): all generation is gated behind mediaGenerationConfigured()
 * — when the media API creds/flag aren't set the module is INERT: generation
 * returns a typed 'disabled' result, the routine still persists (so the founder's
 * intent is captured), and nothing throws. The panel then shows an honest empty
 * state. This guarantees a missing key can never break build/runtime.
 *
 * The heavy I/O (ZeroDB + core Multimodal/Content-Workflow REST) is isolated from
 * the pure logic (frequency validation, next-run computation, brand-prompt
 * building, request shaping) so the pure core is unit-testable without a network —
 * same split as document-store.ts / loop-enrollment.ts.
 */

import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { buildUploadKey, uploadedAssetUrl } from '@/lib/build/media-upload'
import { getAinativeApiKey } from '@/lib/build/env-keys'

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const TABLE_NAME = 'build_media'

/** The core Multimodal / Content-Workflow base (REST for now — #73 has MCP metadata). */
const CORE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The two media kinds a routine produces (Auto Image / Auto Video). */
export const MEDIA_KINDS = ['image', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** Recurrence, mirroring Polsia's selector. 'once' runs a single time then disables. */
export const MEDIA_FREQUENCIES = ['once', 'daily', 'weekly', 'monthly'] as const
export type MediaFrequency = (typeof MEDIA_FREQUENCIES)[number]

/** How each frequency reads in the UI. */
export const FREQUENCY_LABELS: Record<MediaFrequency, string> = {
  once: 'Once',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

/** A row in `build_media` is either a recurring routine or a generated asset. */
export const MEDIA_ROW_KINDS = ['routine', 'asset'] as const
export type MediaRowKind = (typeof MEDIA_ROW_KINDS)[number]

/** A recurring media routine for a company (one per media kind). */
export interface MediaRoutine {
  id: string
  scopeKey: string
  rowKind: 'routine'
  mediaKind: MediaKind
  frequency: MediaFrequency
  enabled: boolean
  createdAt: string
  lastRunAt?: string
  /**
   * Index into {@link VARIATION_DESCRIPTORS} used by the most recent run
   * (#909). Persisted the same way `lastRunAt` already advances, so the next
   * scheduled run knows which scene/composition variant to avoid repeating.
   * Undefined until the routine has actually fired once.
   */
  lastVariant?: number
  /**
   * Index into {@link STYLE_DESCRIPTORS} used by the most recent run (#1018).
   * A SEPARATE rotation from `lastVariant` — composition/framing and
   * style/mood are independent axes, so a company can land on, say,
   * composition-variant 2 + style-variant 0 rather than being locked into one
   * combined rotation of fixed pairs. Persisted and advanced the same way as
   * `lastVariant`. Undefined until the routine has actually fired once.
   */
  lastStyleVariant?: number
}

/** A generated media asset owned by the company. */
export interface MediaAsset {
  id: string
  scopeKey: string
  rowKind: 'asset'
  mediaKind: MediaKind
  url: string
  prompt: string
  createdAt: string
  provider?: string
}

/** The brand a company feeds into the generation prompt (#54 req 4). */
export interface BrandContext {
  companyName?: string
  tagline?: string
  color?: string
  idea?: string
}

// ---------------------------------------------------------------------------
// Pure logic (unit-testable without a network)
// ---------------------------------------------------------------------------

const MS = { day: 86_400_000, week: 604_800_000 }

/** Ownership scope key ({owner}::{companySlug}) — identical to the sibling stores. */
export function mediaScopeKey(
  session: Parameters<typeof deriveOwnerKey>[0],
  companySlug: string,
): string {
  return chatScopeKey(deriveOwnerKey(session), String(companySlug || '').trim())
}

/** Coerce arbitrary input to a valid MediaKind (default 'image'). */
export function normalizeMediaKind(value: unknown): MediaKind {
  const v = String(value || '').toLowerCase().trim()
  return (MEDIA_KINDS as readonly string[]).includes(v) ? (v as MediaKind) : 'image'
}

/** Coerce arbitrary input to a valid MediaFrequency (default 'weekly'). */
export function normalizeFrequency(value: unknown): MediaFrequency {
  const v = String(value || '').toLowerCase().trim()
  return (MEDIA_FREQUENCIES as readonly string[]).includes(v) ? (v as MediaFrequency) : 'weekly'
}

/** Type guard for a valid frequency string. */
export function isMediaFrequency(value: unknown): value is MediaFrequency {
  return typeof value === 'string' && (MEDIA_FREQUENCIES as readonly string[]).includes(value)
}

/**
 * Compute the next run time for a routine given its frequency and the last run.
 * 'once' has no next run (returns null — it fires a single time). daily/weekly/
 * monthly add the appropriate interval to the last run (or, if never run, to `from`
 * so a fresh routine is due immediately). Returns an ISO string or null.
 */
export function nextRunAt(
  frequency: MediaFrequency,
  lastRunAt?: string | null,
  from: Date = new Date(),
): string | null {
  if (frequency === 'once') return lastRunAt ? null : from.toISOString()
  const base = lastRunAt ? new Date(lastRunAt) : null
  if (!base || Number.isNaN(base.getTime())) return from.toISOString() // never run → due now
  const next = new Date(base.getTime())
  if (frequency === 'daily') next.setTime(next.getTime() + MS.day)
  else if (frequency === 'weekly') next.setTime(next.getTime() + MS.week)
  else if (frequency === 'monthly') next.setMonth(next.getMonth() + 1)
  return next.toISOString()
}

/**
 * Is a routine due to run at `now`? A routine is due when it is enabled and its
 * computed next-run time is at/before now. A 'once' routine that has already run
 * (next=null) is never due again.
 */
export function isRoutineDue(routine: Pick<MediaRoutine, 'enabled' | 'frequency' | 'lastRunAt'>, now: Date = new Date()): boolean {
  if (!routine.enabled) return false
  const next = nextRunAt(routine.frequency, routine.lastRunAt, now)
  if (!next) return false
  return new Date(next).getTime() <= now.getTime()
}

/**
 * Rotating scene/composition/angle descriptors (#909) — the prompt-side
 * variation axis that makes a recurring (weekly/monthly) generation actually
 * differ run to run. Core's ImageRequest schema has no seed field at all
 * (confirmed via direct read of core's own schemas/multimodal.py and
 * services/multimodal_service.py), so there is no seed-based lever available
 * even if Builder wanted one — variation has to live in the prompt text
 * itself. Each descriptor is an instruction about COMPOSITION/FRAMING only —
 * never content — so it layers on top of (never replaces) the real-business-
 * grounding instructions in {@link buildBrandPrompt}.
 */
export const VARIATION_DESCRIPTORS = [
  'Composition: a wide establishing shot that shows the full setting or environment this business operates in.',
  'Composition: a close-up shot focused tightly on the product or service itself, or on it actively being used.',
  'Composition: a candid team or customer interaction moment — people engaging with the product, service, or each other.',
  'Composition: an abstract, conceptual visual representation of the core idea or value this business delivers, rather than a literal scene.',
] as const

/**
 * Rotating style/mood descriptors (#1018) — a SECOND, independent variation
 * axis from {@link VARIATION_DESCRIPTORS}. #909 fixed run-to-run repetition
 * for a single company (composition/framing), and the subject-matter
 * grounding in {@link buildBrandPrompt} was already real and working — but
 * the STYLE instruction was one fixed, generic phrase
 * ("modern, clean, professional photography or illustration, high visual
 * quality") sent for EVERY company, every run. A fintech company and a
 * children's toy company got identical style language, so even with varied
 * composition and grounded subject matter, every company's asset read as
 * "the same overarching theme."
 *
 * Each descriptor is an instruction about STYLE/MOOD/AESTHETIC only — never
 * subject matter — so, like the composition axis, it layers on top of (never
 * replaces) the real-business-grounding and no-on-image-text instructions in
 * {@link buildBrandPrompt}. Picked via the SAME {@link pickNextVariant}
 * helper, but with its OWN persisted index (`lastStyleVariant`) so the two
 * axes rotate independently rather than being locked into one combined
 * rotation of fixed pairs — a company can land on composition-variant 2 +
 * style-variant 0 in the same run.
 */
export const STYLE_DESCRIPTORS = [
  'Style: warm and approachable — soft natural lighting, inviting and human, favoring an editorial-photography feel over anything slick or corporate.',
  'Style: bold and energetic — high contrast, vivid saturated color, a dynamic sense of motion and momentum.',
  'Style: minimalist and refined — clean negative space, a restrained palette, precise and uncluttered, premium rather than busy.',
  'Style: grounded and technical — crisp, detail-oriented, documentary-like clarity that foregrounds how the product or process actually works.',
] as const

/**
 * Pick the next variation index (#909), guaranteeing it never repeats the
 * immediately-prior variant for the same company. Pure + deterministic-safe
 * (uses Math.random for the actual pick, but the "never equal to prev"
 * guarantee is structural, not probabilistic retry-based, so it can never
 * loop forever). Defends against a missing/undefined/out-of-range `prev`
 * (first-ever run, malformed persisted data) by treating it as "no
 * constraint" rather than throwing. When `total` is 1, there is nothing to
 * rotate to, so it always returns 0.
 */
export function pickNextVariant(prev: number | undefined | null, total: number): number {
  if (!Number.isFinite(total) || total <= 1) return 0
  const hasValidPrev = typeof prev === 'number' && Number.isInteger(prev) && prev >= 0 && prev < total
  if (!hasValidPrev) return Math.floor(Math.random() * total)
  // Pick uniformly among the (total - 1) remaining indices, then shift past
  // `prev` so the result is never equal to it — structural, not retry-based.
  const offset = 1 + Math.floor(Math.random() * (total - 1))
  return (prev + offset) % total
}

/**
 * Build the on-brand generation prompt from the company's brand artifacts
 * (#54 req 4). Grounded ENTIRELY in real brand fields — never fabricated. Falls
 * back gracefully when a field is missing.
 *
 * FIXED (real, live bug): the previous prompt literally wrote the phrase "an
 * on-brand marketing asset" as prose INSIDE the text sent to the image model —
 * e.g. "Create a marketing image for Beacon, an on-brand marketing asset." Image
 * models routinely render literal prompt phrases as visible text in the image
 * (this is exactly how "BEACON / beacon / on-Brand Marketing asset" ended up
 * baked into a real generated image as on-image copy). "On-brand" was never
 * meant to be something the model DRAWS — it's an instruction about STYLE, not
 * content. The fix: (1) never state that phrase as prose the model could quote
 * back, (2) push the company's real idea/what-it-does to the FRONT of the
 * prompt so the subject matter is actually grounded in this company's business
 * (previously idea was a trailing, easily-ignored clause — a company with no
 * idea text at all, e.g. auto-fired from the nightly loop with just a name,
 * degraded straight to generic stock-photo tropes), and (3) explicitly instruct
 * the model NOT to render any instructional/meta text as visible words unless
 * it is a real, intentional headline.
 *
 * #909: recurring (weekly/monthly) auto-media generation produced the exact
 * same image every run because this function was fully deterministic for a
 * given BrandContext. `variantIndex` (optional, defaults to 0 for back-compat
 * with any caller that doesn't thread one through) selects a rotating
 * scene/composition/angle descriptor from {@link VARIATION_DESCRIPTORS},
 * appended AFTER all the grounding/no-text instructions so it can never
 * weaken them. An out-of-range or missing index safely falls back to index 0
 * rather than throwing or producing "undefined" in the prompt text.
 *
 * #1018: the STYLE line used to be one fixed, generic phrase
 * ("modern, clean, professional photography or illustration, high visual
 * quality") sent for every company, every run — never varying by industry or
 * brand personality. `styleIndex` (optional, same back-compat default of 0)
 * independently selects a rotating style/mood descriptor from
 * {@link STYLE_DESCRIPTORS}, REPLACING that static line (it was never a
 * grounding instruction, just inert filler) rather than adding alongside it.
 * It is a SEPARATE index from `variantIndex` — composition and style rotate
 * independently, not as one combined pairing — validated and defaulted the
 * exact same defensive way.
 */
export function buildBrandPrompt(
  mediaKind: MediaKind,
  brand: BrandContext,
  variantIndex?: number,
  styleIndex?: number,
): string {
  const name = (brand.companyName || 'the company').trim()
  const tagline = (brand.tagline || '').trim()
  const idea = (brand.idea || '').trim()
  const color = (brand.color || '').trim()
  const noun = mediaKind === 'video' ? 'a short promotional video' : 'a marketing image'
  const subject = idea
    ? `${name}: ${idea}`
    : `${name}${tagline ? ` — ${tagline}` : ''}`
  const safeIndex =
    typeof variantIndex === 'number' && Number.isInteger(variantIndex) && variantIndex >= 0 && variantIndex < VARIATION_DESCRIPTORS.length
      ? variantIndex
      : 0
  const variation = VARIATION_DESCRIPTORS[safeIndex]
  const safeStyleIndex =
    typeof styleIndex === 'number' && Number.isInteger(styleIndex) && styleIndex >= 0 && styleIndex < STYLE_DESCRIPTORS.length
      ? styleIndex
      : 0
  const style = STYLE_DESCRIPTORS[safeStyleIndex]
  const parts = [
    `Create ${noun} for a real company. What this company actually does: ${subject}.`,
    'The image must depict THIS business — its real product, service, or the problem it',
    'solves — not a generic, unrelated stock scene. Ground every visual choice (setting,',
    'subject, objects) in what the company does; do not default to an unrelated industry',
    '(e.g. fashion/apparel imagery) unless the company itself is in that industry.',
    tagline ? `Brand tagline (for tone only — do not render this text in the image): "${tagline}".` : '',
    color ? `Use the brand accent color ${color} prominently in the palette.` : '',
    style,
    'Do NOT render any words, letters, logos, or captions in the image — no text overlays',
    'of any kind, including the company name, tagline, or any instructional phrasing from',
    'this prompt. This must be a purely visual asset with zero on-image text.',
    variation,
  ]
  return parts.filter(Boolean).join(' ')
}

/**
 * Shape the request body for the core Multimodal generation endpoint from a media
 * kind + prompt. Pure — no network — so the request contract is unit-testable.
 *
 * #403: the bare `/api/v1/multimodal/video` path this used to send never
 * existed on core — confirmed via direct read of core's real FastAPI router
 * (app/api/api_v1/endpoints/multimodal.py), which only registers
 * `/video/i2v`, `/video/t2v`, `/video/cogvideox`. Every video-generation call
 * has 404'd against core since #54 shipped (silently — the caller already
 * treats a failed generation as an honest 'failed' state, never a crash,
 * which is why this went unnoticed). Builder only ever sends a text prompt
 * (no source image), matching `/video/t2v` (text-to-video) — never
 * `/video/i2v` (needs a source image) or `/video/cogvideox`. Core's real
 * VideoT2VRequest schema is `{prompt, duration}` (schemas/multimodal.py:101),
 * not `{prompt, kind}` — `duration` defaults to 5s server-side if omitted.
 *
 * Note: core's real response for a video job is ASYNC (status:'processing' +
 * task_id, not an immediate video_url) — the polling gap this implies is
 * tracked separately as #404, out of scope for this routing fix.
 */
export function buildGenerationRequest(mediaKind: MediaKind, prompt: string): {
  path: string
  body: Record<string, unknown>
} {
  return {
    path: mediaKind === 'video' ? '/api/v1/multimodal/video/t2v' : '/api/v1/multimodal/image',
    body: mediaKind === 'video' ? { prompt } : { prompt, kind: mediaKind },
  }
}

/**
 * Whether media generation is configured + enabled (#54 req 6). Inert unless BOTH
 * the feature flag is on AND an API key is present, so a missing key can never
 * break build/runtime — generation simply reports 'disabled' and the panel shows
 * an honest empty state.
 */
export function mediaGenerationConfigured(): boolean {
  const flag = String(process.env.BUILD_MEDIA_ENABLED || '').toLowerCase()
  const enabled = flag === '1' || flag === 'true' || flag === 'yes'
  return enabled && Boolean(getApiKey())
}

function getApiKey(): string {
  return getAinativeApiKey()
}

/**
 * Ensure the `build_media` ZeroDB table exists before writing to it. Live-
 * confirmed in production: the table was never created (`404 Table
 * 'build_media' not found`), so every real "START AUTO" schedule save has
 * been silently failing since this feature shipped — `saveRoutine` returned
 * null, the route returned 502, and the founder saw "Could not save the
 * schedule — try again shortly" no matter how many times they retried.
 * Mirrors `app/api/db/[table]/route.ts`'s and `primitive-credentials.ts`'s
 * proven `ensureTable` pattern exactly: best-effort, idempotent (ZeroDB
 * no-ops on an existing table), never throws — the real write's own result
 * stays authoritative either way.
 */
async function ensureTable(): Promise<void> {
  try {
    await fetch(`${ZERODB_API}/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST',
      headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_name: TABLE_NAME }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Table might already exist, or the create call itself failed — either
    // way, fall through to the real write and let ITS result be authoritative.
  }
}

/** Coerce a raw ZeroDB row into a MediaRoutine, or null when malformed. */
export function coerceRoutine(raw: any, scopeKey = ''): MediaRoutine | null {
  const r = raw?.row_data || raw
  if (!r || r.rowKind !== 'routine') return null
  const id = String(r.id || '')
  if (!id) return null
  return {
    id,
    scopeKey: String(r.scopeKey || scopeKey),
    rowKind: 'routine',
    mediaKind: normalizeMediaKind(r.mediaKind),
    frequency: normalizeFrequency(r.frequency),
    enabled: Boolean(r.enabled),
    createdAt: String(r.createdAt || new Date().toISOString()),
    lastRunAt: r.lastRunAt ? String(r.lastRunAt) : undefined,
    lastVariant: Number.isInteger(r.lastVariant) ? Number(r.lastVariant) : undefined,
    lastStyleVariant: Number.isInteger(r.lastStyleVariant) ? Number(r.lastStyleVariant) : undefined,
  }
}

/** Coerce a raw ZeroDB row into a MediaAsset, or null when malformed / no url. */
export function coerceAsset(raw: any, scopeKey = ''): MediaAsset | null {
  const r = raw?.row_data || raw
  if (!r || r.rowKind !== 'asset') return null
  const id = String(r.id || '')
  const url = String(r.url || '')
  if (!id || !url) return null
  return {
    id,
    scopeKey: String(r.scopeKey || scopeKey),
    rowKind: 'asset',
    mediaKind: normalizeMediaKind(r.mediaKind),
    url,
    prompt: String(r.prompt || ''),
    createdAt: String(r.createdAt || new Date().toISOString()),
    provider: r.provider ? String(r.provider) : undefined,
  }
}

/** Newest-first sort by createdAt. */
export function sortByCreatedDesc<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// ---------------------------------------------------------------------------
// ZeroDB + core Multimodal I/O — isolated from the pure logic above
// ---------------------------------------------------------------------------

async function zerodbRequest(method: string, path: string, body?: unknown, retries = 0): Promise<any> {
  const url = `${ZERODB_API}${path}`
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12_000),
      })
      if (!res.ok) {
        if (attempt < retries && (res.status === 401 || res.status === 429 || res.status >= 500)) continue
        return null
      }
      return await res.json()
    } catch {
      if (attempt >= retries) return null
    }
  }
  return null
}

/**
 * Upsert the media routine for a {scope, mediaKind}. Best-effort: appends a routine
 * row (newest wins on read). Returns the routine on success, null on failure —
 * never throws. Persists EVEN when generation is unconfigured, so the founder's
 * intent (their chosen frequency) is captured now and honored once creds are set.
 */
export async function saveRoutine(
  scopeKey: string,
  input: {
    mediaKind: MediaKind
    frequency: MediaFrequency
    enabled?: boolean
    lastRunAt?: string
    lastVariant?: number
    lastStyleVariant?: number
  },
): Promise<MediaRoutine | null> {
  if (!scopeKey) return null
  const now = new Date().toISOString()
  const routine: MediaRoutine = {
    id: `mr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    scopeKey,
    rowKind: 'routine',
    mediaKind: normalizeMediaKind(input.mediaKind),
    frequency: normalizeFrequency(input.frequency),
    enabled: input.enabled !== false,
    createdAt: now,
    lastRunAt: input.lastRunAt,
    lastVariant: Number.isInteger(input.lastVariant) ? input.lastVariant : undefined,
    lastStyleVariant: Number.isInteger(input.lastStyleVariant) ? input.lastStyleVariant : undefined,
  }
  await ensureTable()
  const result = await zerodbRequest(
    'POST',
    `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
    { row_data: routine },
  )
  return result ? routine : null
}

/** Persist a generated asset owned by the company. Returns it, or null on failure. */
export async function saveAsset(
  scopeKey: string,
  input: { mediaKind: MediaKind; url: string; prompt: string; provider?: string },
): Promise<MediaAsset | null> {
  if (!scopeKey || !input?.url) return null
  const asset: MediaAsset = {
    id: `ma_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    scopeKey,
    rowKind: 'asset',
    mediaKind: normalizeMediaKind(input.mediaKind),
    url: String(input.url),
    prompt: String(input.prompt || '').slice(0, 2000),
    createdAt: new Date().toISOString(),
    provider: input.provider,
  }
  await ensureTable()
  const result = await zerodbRequest(
    'POST',
    `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
    { row_data: asset },
  )
  return result ? asset : null
}

/** List all media rows for a scope; splits into the latest routine per kind + assets. */
export async function listMedia(scopeKey: string): Promise<{ routines: MediaRoutine[]; assets: MediaAsset[] }> {
  if (!scopeKey) return { routines: [], assets: [] }
  const result = await zerodbRequest(
    'POST',
    `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
    { filters: { scopeKey }, limit: 200 },
    1,
  )
  const rows: any[] = result?.data || result?.rows || []
  const routinesAll = sortByCreatedDesc(
    rows.map((r) => coerceRoutine(r, scopeKey)).filter((x): x is MediaRoutine => x !== null),
  )
  const assets = sortByCreatedDesc(
    rows.map((r) => coerceAsset(r, scopeKey)).filter((x): x is MediaAsset => x !== null),
  )
  // Latest routine per media kind wins (upsert-by-append semantics).
  const latestByKind = new Map<MediaKind, MediaRoutine>()
  for (const r of routinesAll) if (!latestByKind.has(r.mediaKind)) latestByKind.set(r.mediaKind, r)
  return { routines: [...latestByKind.values()], assets }
}

/**
 * Upload raw image bytes to the project's ZeroDB file storage (#323 / GR-14) —
 * the same S3-backed files bucket the platform owns, under the same project as
 * the `build_media` rows. Returns the ZeroDB file id on success, '' on any
 * failure — never throws, so a storage hiccup can't 500 the upload route.
 *
 * Endpoint (verified): POST {ZERODB_API}/v1/projects/{id}/files/upload with a
 * multipart `file` field; the file name may carry a folder path (uploads/…).
 */
export async function uploadMediaFile(input: {
  bytes: ArrayBuffer | Uint8Array
  key: string
  contentType: string
}): Promise<string> {
  if (!input?.key || !input?.bytes) return ''
  try {
    const form = new FormData()
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes)
    form.append('file', new Blob([bytes as BlobPart], { type: input.contentType }), input.key)
    const res = await fetch(`${ZERODB_API}/v1/projects/${PROJECT_ID}/files/upload`, {
      method: 'POST',
      headers: { 'X-API-Key': getApiKey() },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return ''
    const data = await res.json().catch(() => null)
    const id = String(data?.file_id || '')
    return id
  } catch {
    return ''
  }
}

/**
 * Resolve a fresh (presigned, short-lived) download URL + content type for a
 * stored ZeroDB file. The serve route redirects to this on every request so the
 * asset's OWN url ({@link import('./media-upload').uploadedAssetUrl}) stays
 * durable while the bucket presigns keep expiring. Null on any failure.
 */
export async function fetchFileDownload(
  fileId: string,
): Promise<{ url: string; contentType: string } | null> {
  if (!fileId) return null
  try {
    const res = await fetch(`${ZERODB_API}/v1/projects/${PROJECT_ID}/files/${fileId}/download`, {
      method: 'GET',
      headers: { 'X-API-Key': getApiKey() },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const url = String(data?.download_url || '')
    if (!url) return null
    return { url, contentType: String(data?.content_type || 'application/octet-stream') }
  } catch {
    return null
  }
}

/**
 * Real, terminal statuses MiniMax's video job reports (raw strings, passed
 * through unchanged by core's `get_video_status` — confirmed via core source,
 * `services/minimax_video_service.py`). 'Success' is the only completion
 * state that carries a video_url; 'Fail'/'Failed' are honest terminal
 * failures. Anything else ('Preparing'/'Processing'/'Queueing'/etc.) means
 * keep polling.
 */
const VIDEO_STATUS_SUCCESS = 'Success'
const VIDEO_STATUS_FAILURES = new Set(['Fail', 'Failed'])

/** Extract a usable video URL from any of the response shapes core may return. */
function extractVideoUrl(data: any): string {
  return String(data?.video_url || data?.url || data?.output?.url || data?.data?.url || data?.asset_url || '')
}

/**
 * Core's real image endpoint (confirmed live, 2026-09) returns
 * `{image_base64: "..."}` inline — NOT a url field, unlike the video
 * endpoint's shape extractVideoUrl expects. Every real image generation call
 * was silently returning {status:'failed'} because `url` was always empty
 * for images: the base64 payload was never decoded, uploaded to durable
 * storage, or turned into a URL at all — that handling simply didn't exist.
 */
function extractImageBase64(data: any): string {
  return String(data?.image_base64 || data?.data?.image_base64 || '')
}

/**
 * Decode a generated image's base64 payload, upload it to the company's own
 * ZeroDB file storage (the SAME store founder photo uploads use, #323), and
 * return the durable serve URL. Empty string on any failure — the caller
 * treats that exactly like any other generation failure (honest 'failed',
 * never a crash).
 */
async function persistBase64Image(scopeKey: string, base64: string): Promise<string> {
  try {
    const bytes = Buffer.from(base64, 'base64')
    if (!bytes.length) return ''
    const key = buildUploadKey(scopeKey, `generated-${Date.now()}.png`)
    const fileId = await uploadMediaFile({ bytes, key, contentType: 'image/png' })
    return fileId ? uploadedAssetUrl(fileId) : ''
  } catch {
    return ''
  }
}

/**
 * Poll core's video status endpoint until the job reaches a terminal state
 * (#404) — video generation is genuinely async (MiniMax jobs take 1-5 min);
 * the initial POST only returns status:'processing' + task_id, never a
 * finished video_url. Bounded by both a max attempt count and an overall
 * timeout so this NEVER hangs indefinitely — mirrors core's own polling
 * defaults (`generate_video`'s poll_timeout_s=300, poll_interval_s=5) as the
 * evidence-based starting point, not a guess.
 *
 * Pure with respect to timing (interval/timeout are injectable) so the
 * retry/timeout logic is unit-testable without real waits.
 *
 * #884: every poll failure used to vanish into a bare `catch {}` with no
 * logging at all — a non-ok response, a terminal Fail/Failed status, a
 * Success with no video_url, AND a thrown network/abort error all collapsed
 * into either silent retries or a silent 'failed' return. Each distinct
 * branch now logs the real signal (status code/body, raw job status, or the
 * caught error) so a stuck/failing video job is actually diagnosable from
 * server logs instead of indistinguishable noise.
 */
export async function pollVideoStatus(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ status: 'completed' | 'failed' | 'timeout'; videoUrl?: string }> {
  const intervalMs = opts.intervalMs ?? 5_000
  const timeoutMs = opts.timeoutMs ?? 300_000
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${CORE_API}/api/v1/multimodal/video/status/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { 'X-API-Key': getApiKey() },
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        const rawStatus = String(data?.status || '')
        if (rawStatus === VIDEO_STATUS_SUCCESS) {
          const videoUrl = extractVideoUrl(data)
          if (!videoUrl) {
            console.error('[media-schedule] pollVideoStatus: Success status with no extractable video url', {
              taskId,
              data,
            })
            return { status: 'failed' }
          }
          return { status: 'completed', videoUrl }
        }
        if (VIDEO_STATUS_FAILURES.has(rawStatus)) {
          console.error('[media-schedule] pollVideoStatus: job reported a terminal failure status', {
            taskId,
            rawStatus,
            data,
          })
          return { status: 'failed' }
        }
        // Any other status (Preparing/Processing/Queueing/…) → keep polling.
      } else {
        console.error('[media-schedule] pollVideoStatus: non-2xx response while polling', {
          taskId,
          status: res.status,
          statusText: res.statusText,
          body: await res.text().catch(() => '<unreadable>'),
        })
      }
    } catch (err) {
      // Transient poll failure (network error, AbortSignal timeout firing,
      // JSON parse failure) — keep trying until the deadline, but log the
      // real error instead of swallowing it silently.
      console.error('[media-schedule] pollVideoStatus: poll attempt threw', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    await sleep(intervalMs)
  }
  console.error('[media-schedule] pollVideoStatus: timed out waiting for a terminal status', {
    taskId,
    timeoutMs,
  })
  return { status: 'timeout' }
}

/**
 * The specific reason a 'failed' result carries (#884). MediaPanel can use this
 * to show a status-specific message instead of one generic string for every
 * distinct failure mode; every branch below also console.errors the real
 * underlying signal (status/body/error) so a failure is diagnosable from logs
 * even before any UI picks `reason` up.
 */
export const MEDIA_FAILURE_REASONS = [
  'core_error',
  'poll_timeout',
  'poll_failed',
  'no_asset_url',
  'save_failed',
  'exception',
] as const
export type MediaFailureReason = (typeof MEDIA_FAILURE_REASONS)[number]

/**
 * Run a single media generation against the core Multimodal primitive and persist
 * the resulting asset to the company's own storage. GATED (#54 req 6): returns a
 * typed result and NEVER throws.
 *   - 'disabled'  → generation isn't configured (flag/key) — inert, no-op.
 *   - 'failed'    → configured, but the generation call produced no asset
 *                   (see `reason` for which branch, and server logs for the
 *                   real underlying status/error — #884).
 *   - 'generated' → an on-brand asset was produced + persisted (asset returned).
 *
 * #404: video generation is genuinely async — the initial POST only accepts
 * the job (status:'processing' + task_id), it never returns a finished
 * video_url. When the response carries a task_id, poll for completion before
 * giving up; image generation is unaffected (confirmed synchronous — no
 * task_id in its response shape).
 *
 * #884: every distinct failure branch (non-2xx core response, failed/timed-out
 * poll, no resolvable url/task_id, a failed persist, and the swallowed
 * top-level catch) used to collapse into the same bare `{ status: 'failed' }`
 * with ZERO logging anywhere — making a real failure indistinguishable from
 * every other failure mode. Each branch now console.errors the real signal
 * (response status/body, poll outcome, or caught error) and tags the result
 * with a specific `reason` so this is actually diagnosable.
 *
 * #1018: `styleIndex` (optional, independent from `variantIndex`) selects the
 * rotating style/mood descriptor — see {@link buildBrandPrompt}.
 */
export async function runMediaGeneration(
  scopeKey: string,
  mediaKind: MediaKind,
  brand: BrandContext,
  variantIndex?: number,
  styleIndex?: number,
): Promise<{ status: 'disabled' | 'failed' | 'generated'; asset?: MediaAsset; reason?: MediaFailureReason }> {
  if (!mediaGenerationConfigured()) return { status: 'disabled' }
  const prompt = buildBrandPrompt(mediaKind, brand, variantIndex, styleIndex)
  const { path, body } = buildGenerationRequest(mediaKind, prompt)
  try {
    const res = await fetch(`${CORE_API}${path}`, {
      method: 'POST',
      headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      console.error('[media-schedule] runMediaGeneration: core generation call returned non-2xx', {
        scopeKey,
        mediaKind,
        path,
        status: res.status,
        statusText: res.statusText,
        body: await res.text().catch(() => '<unreadable>'),
      })
      return { status: 'failed', reason: 'core_error' }
    }
    const data = await res.json().catch((err) => {
      console.error('[media-schedule] runMediaGeneration: core response was not valid JSON', {
        scopeKey,
        mediaKind,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    })
    let url = extractVideoUrl(data)
    if (!url && mediaKind === 'image') {
      const base64 = extractImageBase64(data)
      if (base64) url = await persistBase64Image(scopeKey, base64)
    }
    const taskId = String(data?.task_id || '')
    if (!url && mediaKind === 'video' && taskId && String(data?.status || '') !== VIDEO_STATUS_SUCCESS) {
      const polled = await pollVideoStatus(taskId)
      if (polled.status !== 'completed' || !polled.videoUrl) {
        console.error('[media-schedule] runMediaGeneration: video polling did not complete', {
          scopeKey,
          mediaKind,
          taskId,
          pollStatus: polled.status,
        })
        return { status: 'failed', reason: polled.status === 'timeout' ? 'poll_timeout' : 'poll_failed' }
      }
      url = polled.videoUrl
    }
    if (!url) {
      console.error('[media-schedule] runMediaGeneration: no resolvable asset url or task_id in the core response', {
        scopeKey,
        mediaKind,
        data,
      })
      return { status: 'failed', reason: 'no_asset_url' }
    }
    const asset = await saveAsset(scopeKey, { mediaKind, url, prompt, provider: data?.provider || data?.model })
    if (!asset) {
      console.error('[media-schedule] runMediaGeneration: generated asset failed to persist to ZeroDB', {
        scopeKey,
        mediaKind,
        url,
      })
      return { status: 'failed', reason: 'save_failed' }
    }
    return { status: 'generated', asset }
  } catch (err) {
    // Any thrown exception — network error, the 60s AbortSignal.timeout firing,
    // or anything else unexpected — used to vanish here with no trace at all.
    console.error('[media-schedule] runMediaGeneration: unhandled exception during generation', {
      scopeKey,
      mediaKind,
      path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return { status: 'failed', reason: 'exception' }
  }
}
