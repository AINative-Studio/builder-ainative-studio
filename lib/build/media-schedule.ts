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
 * Build the on-brand generation prompt from the company's brand artifacts
 * (#54 req 4). Grounded ENTIRELY in real brand fields — never fabricated. Falls
 * back gracefully when a field is missing.
 */
export function buildBrandPrompt(mediaKind: MediaKind, brand: BrandContext): string {
  const name = (brand.companyName || 'the company').trim()
  const tagline = (brand.tagline || '').trim()
  const idea = (brand.idea || '').trim()
  const color = (brand.color || '').trim()
  const noun = mediaKind === 'video' ? 'a short promotional video' : 'a marketing image'
  const parts = [
    `Create ${noun} for ${name}, an on-brand marketing asset.`,
    tagline ? `Brand tagline: "${tagline}".` : '',
    idea ? `What the company does: ${idea}.` : '',
    color ? `Use the brand accent color ${color} prominently.` : '',
    'Style: modern, clean, professional. No text overlays unless essential. High visual quality.',
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
  return process.env.AINATIVE_API_KEY || process.env.API_Key || process.env.ZERODB_API_KEY || ''
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
  input: { mediaKind: MediaKind; frequency: MediaFrequency; enabled?: boolean; lastRunAt?: string },
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
          return videoUrl ? { status: 'completed', videoUrl } : { status: 'failed' }
        }
        if (VIDEO_STATUS_FAILURES.has(rawStatus)) {
          return { status: 'failed' }
        }
        // Any other status (Preparing/Processing/Queueing/…) → keep polling.
      }
    } catch {
      // Transient poll failure — keep trying until the deadline, never throw.
    }
    await sleep(intervalMs)
  }
  return { status: 'timeout' }
}

/**
 * Run a single media generation against the core Multimodal primitive and persist
 * the resulting asset to the company's own storage. GATED (#54 req 6): returns a
 * typed result and NEVER throws.
 *   - 'disabled'  → generation isn't configured (flag/key) — inert, no-op.
 *   - 'failed'    → configured, but the generation call produced no asset.
 *   - 'generated' → an on-brand asset was produced + persisted (asset returned).
 *
 * #404: video generation is genuinely async — the initial POST only accepts
 * the job (status:'processing' + task_id), it never returns a finished
 * video_url. When the response carries a task_id, poll for completion before
 * giving up; image generation is unaffected (confirmed synchronous — no
 * task_id in its response shape).
 */
export async function runMediaGeneration(
  scopeKey: string,
  mediaKind: MediaKind,
  brand: BrandContext,
): Promise<{ status: 'disabled' | 'failed' | 'generated'; asset?: MediaAsset }> {
  if (!mediaGenerationConfigured()) return { status: 'disabled' }
  const prompt = buildBrandPrompt(mediaKind, brand)
  const { path, body } = buildGenerationRequest(mediaKind, prompt)
  try {
    const res = await fetch(`${CORE_API}${path}`, {
      method: 'POST',
      headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) return { status: 'failed' }
    const data = await res.json().catch(() => null)
    let url = extractVideoUrl(data)
    if (!url && mediaKind === 'image') {
      const base64 = extractImageBase64(data)
      if (base64) url = await persistBase64Image(scopeKey, base64)
    }
    const taskId = String(data?.task_id || '')
    if (!url && mediaKind === 'video' && taskId && String(data?.status || '') !== VIDEO_STATUS_SUCCESS) {
      const polled = await pollVideoStatus(taskId)
      if (polled.status !== 'completed' || !polled.videoUrl) return { status: 'failed' }
      url = polled.videoUrl
    }
    if (!url) return { status: 'failed' }
    const asset = await saveAsset(scopeKey, { mediaKind, url, prompt, provider: data?.provider || data?.model })
    return asset ? { status: 'generated', asset } : { status: 'failed' }
  } catch {
    return { status: 'failed' }
  }
}
