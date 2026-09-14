/**
 * Phone OTP for founder registration (#734, sibling of #733).
 *
 * #733 adds `sendZeroVoiceSms(jwt, fromE164, toE164, body)` to zerovoice.ts,
 * scoped for an ALREADY-PROVISIONED company sending FROM its own
 * founder-owned ZeroVoice number, authenticated with the founder's own
 * AINative JWT (see app-registry.ts's `zerovoiceE164` — a per-company
 * number captured at provision time).
 *
 * At REGISTRATION time (this file) neither of those exist yet: there is no
 * company, no founder-owned ZeroVoice number, and no founder JWT (the
 * founder isn't authenticated yet — that's the whole point of registering).
 * Reusing sendZeroVoiceSms here is a type error waiting to happen (its
 * signature requires a real per-founder jwt + fromE164 this flow cannot
 * supply) and would also create a needless merge dependency on #733's
 * unmerged branch. This file is therefore a small, self-contained,
 * registration-scoped SMS sender, deliberately NOT importing from
 * zerovoice.ts.
 *
 * THE OPEN QUESTION THIS FILE DOCUMENTS HONESTLY (do not paper over this):
 * sending an OTP at registration requires a SHARED/POOL ZeroVoice number
 * (Builder's own, not any founder's) plus a Builder-owned SERVICE-LEVEL
 * ZeroVoice credential to send from it. Investigated live against
 * ZeroVoice's real openapi.json (2026-09-13):
 *   - POST /api/v1/sms/send requires `security: [{HTTPBearer: []}]` — a
 *     ZeroVoice-tenant JWT from ZeroVoice's OWN /auth/login system (its
 *     openapi.json lists /auth/login, /auth/refresh, /auth/logout as a
 *     dedicated auth surface, separate from AINative's X-API-Key model).
 *     The X-API-Key header sms/send also accepts is declared optional in
 *     the schema with no documented alternate-auth semantics — it cannot be
 *     assumed to substitute for the bearer requirement.
 *   - GET/POST /api/v1/numbers/caller-id-pool is a REAL endpoint, but per
 *     its own description it manages caller-ID *reputation* across numbers
 *     a tenant ALREADY OWNS for outbound dialer campaigns — not a
 *     shared-send-on-behalf-of-anonymous-users mechanism. It's still
 *     HTTPBearer (tenant-scoped), so it doesn't remove the credential gap.
 *   - This repo's Railway env (checked via `railway variables --service
 *     builder-ainative-studio`) has ZEROVOICE_PROVISION_ENABLED=true but NO
 *     ZEROVOICE_SERVICE_-style or ZEROVOICE_POOL_-style credential, and no
 *     Builder-owned ZeroVoice tenant account/JWT exists anywhere in this codebase.
 *     Builder's own AINATIVE_API_KEY (lib/build/env-keys.ts) is scoped to
 *     AINative's platform API, not ZeroVoice's separate auth realm, so it is
 *     NOT a valid substitute.
 *
 * CONCLUSION: sending a real OTP SMS from a shared number is not possible
 * today without a human provisioning a Builder-owned ZeroVoice tenant
 * (a real /auth/login account + a purchased/assigned pool number) and
 * wiring its credential into this service's env. Rather than fabricate a
 * working send against a nonexistent credential, the actual HTTP call is
 * gated behind ZEROVOICE_OTP_ENABLED (default OFF — mirrors
 * zeroVoiceProvisionEnabled()'s pattern in zerovoice.ts exactly). All the
 * OTHER logic here (code generation, ZeroDB storage, TTL, rate limiting,
 * verification) is real and fully wired — only the final external send is
 * gated, and it fails with an honest `{ok:false, reason:'not_configured'}`
 * rather than pretending to succeed.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const OTP_TABLE = 'builder_otp_codes'

const ZV_BASE = process.env.ZEROVOICE_API_URL || 'https://zerovoice-production.up.railway.app/api/v1'

const OTP_TTL_MS = 10 * 60 * 1000 // 10 minutes
const OTP_LENGTH = 6

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${OTP_TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

/**
 * Whether a real OTP SMS send is enabled. Default OFF — see the file-level
 * doc above for why: no Builder-owned ZeroVoice service credential exists
 * today. Mirrors zeroVoiceProvisionEnabled()'s exact pattern in zerovoice.ts.
 */
export function zeroVoiceOtpEnabled(): boolean {
  return process.env.ZEROVOICE_OTP_ENABLED === 'true'
}

/**
 * Normalize a phone number to E.164 (client- and server-side; no npm
 * dependency). Best-effort: assumes US/CA (+1) for a bare 10-digit number
 * (Builder's current market), passes through a number already starting
 * with '+', and returns null for anything that doesn't look like a real
 * number after stripping formatting characters.
 */
export function toE164(raw: string): string | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) return null
    return `+${digits}`
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}

interface OtpRow {
  phone: string
  code: string
  expiresAt: string
  createdAt: string
  verified?: boolean
  consumedAt?: string
}

/**
 * Ensure the `builder_otp_codes` ZeroDB table exists before writing to it.
 * This codebase has hit this exact class of bug twice before on a
 * brand-new table (build_media, build_documents — see document-store.ts's
 * own ensureTable doc comment) — a new table 404s on its very first write
 * until something creates it. Best-effort, idempotent (ZeroDB no-ops on an
 * existing table), never throws — the real write's own result stays
 * authoritative either way.
 */
async function ensureOtpTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ table_name: OTP_TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Table might already exist, or the create call itself failed — either
    // way, fall through to the real write and let ITS result be authoritative.
  }
}

async function insertOtpRow(row: OtpRow): Promise<boolean> {
  if (!configured()) return false
  await ensureOtpTable()
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ row_data: row }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** All rows for a phone number, newest first. Empty array on any failure. */
async function rowsForPhone(phone: string): Promise<OtpRow[]> {
  if (!configured()) return []
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) return []
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const matches = rows
      .map((r: { row_data?: OtpRow }) => r.row_data)
      .filter((rd: OtpRow | undefined): rd is OtpRow => rd?.phone === phone)
    matches.sort((a: OtpRow, b: OtpRow) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return matches
  } catch {
    return []
  }
}

export interface SendOtpResult {
  ok: boolean
  reason?: string
  expiresAt?: string
}

/**
 * Generate a 6-digit code, persist it (ZeroDB, TTL below), and send it via
 * a Builder-service-level ZeroVoice SMS send from a shared/pool number.
 *
 * Real, honest gating: when ZEROVOICE_OTP_ENABLED is not 'true' (the
 * default — see file doc), the code is still generated and stored (so the
 * rest of the flow, including tests, exercises real logic), but the actual
 * external send is skipped and this returns
 * `{ok:false, reason:'not_configured'}` — never a fabricated success.
 */
export async function sendOtp(phone: string): Promise<SendOtpResult> {
  if (!phone) return { ok: false, reason: 'invalid_phone' }
  if (!configured()) return { ok: false, reason: 'registry_unavailable' }

  const code = String(Math.floor(Math.random() * 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString()

  const stored = await insertOtpRow({ phone, code, expiresAt, createdAt: now.toISOString() })
  if (!stored) return { ok: false, reason: 'storage_failed' }

  if (!zeroVoiceOtpEnabled()) {
    // Real, honest blocker — see file doc. Do NOT fabricate a successful
    // send; the code above is genuinely stored and would verify correctly
    // if a human somehow relayed it, but no SMS is actually dispatched.
    return { ok: false, reason: 'not_configured', expiresAt }
  }

  const sendResult = await sendSharedOtpSms(phone, `Your AINative Builder verification code is ${code}. It expires in 10 minutes.`)
  if (!sendResult.ok) return { ok: false, reason: sendResult.reason || 'send_failed', expiresAt }
  return { ok: true, expiresAt }
}

interface SharedSmsResult {
  ok: boolean
  reason?: string
}

/**
 * Minimal, self-contained "send one SMS via ZeroVoice using a Builder
 * service credential" call — deliberately not shared with zerovoice.ts's
 * founder-JWT-scoped sendZeroVoiceSms (see file doc for why). Reads a
 * hypothetical service credential + pool number from env; both are
 * currently UNSET in this repo's environment (confirmed via `railway
 * variables`), so this only ever executes when a human wires them up AND
 * flips ZEROVOICE_OTP_ENABLED — until then, callers should short-circuit on
 * zeroVoiceOtpEnabled() before ever reaching this function (sendOtp does).
 */
async function sendSharedOtpSms(toE164Number: string, body: string): Promise<SharedSmsResult> {
  const serviceJwt = process.env.ZEROVOICE_SERVICE_JWT || ''
  const poolFromNumber = process.env.ZEROVOICE_POOL_E164 || ''
  if (!serviceJwt || !poolFromNumber) return { ok: false, reason: 'not_configured' }

  try {
    const res = await fetch(`${ZV_BASE}/sms/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_number: poolFromNumber, to_number: toE164Number, body }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      return { ok: false, reason: String(data?.message || data?.detail || res.status).slice(0, 160) }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}

export interface VerifyOtpResult {
  ok: boolean
  reason?: string
}

/**
 * Verify a submitted code against the most recent stored OTP for this
 * phone. Single-use: a matched code is invalidated (consumedAt set) via an
 * appended row so a replay of the same code fails afterward (append-only
 * ZeroDB — latest-wins read, mirrors app-registry.ts's lifecycle pattern).
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  if (!phone || !code) return { ok: false, reason: 'invalid_request' }
  if (!configured()) return { ok: false, reason: 'registry_unavailable' }

  const rows = await rowsForPhone(phone)
  const latest = rows[0]
  if (!latest) return { ok: false, reason: 'no_code_sent' }
  if (latest.consumedAt || latest.verified) return { ok: false, reason: 'already_used' }
  if (new Date(latest.expiresAt).getTime() < Date.now()) return { ok: false, reason: 'expired' }
  if (latest.code !== String(code).trim()) return { ok: false, reason: 'mismatch' }

  // Mark consumed (single-use) by appending an updated row — latest-wins on
  // the next read means a replay of this same code sees consumedAt set.
  await insertOtpRow({ ...latest, verified: true, consumedAt: new Date().toISOString() })
  return { ok: true }
}

// --- Rate limiting (send-otp only; a few sends per hour per phone AND per IP) ---

const RATE_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_SENDS_PER_PHONE = 3
const MAX_SENDS_PER_IP = 10

// In-memory sliding window, matching lib/middleware/rate-limit.ts's own
// in-memory fallback pattern (no Redis dependency for this narrow,
// low-volume endpoint). Per-process only — acceptable for a single Railway
// instance; a future multi-instance deploy should move this to the same
// Upstash-backed limiter rate-limit.ts already wires up.
const sendAttempts = new Map<string, number[]>()

function withinLimit(key: string, max: number): boolean {
  const now = Date.now()
  const timestamps = (sendAttempts.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (timestamps.length >= max) {
    sendAttempts.set(key, timestamps)
    return false
  }
  timestamps.push(now)
  sendAttempts.set(key, timestamps)
  return true
}

/** Check (and record, on success) a send-otp attempt for this phone + IP. */
export function checkOtpRateLimit(phone: string, ip: string): { ok: boolean; reason?: string } {
  const phoneOk = withinLimit(`phone:${phone}`, MAX_SENDS_PER_PHONE)
  if (!phoneOk) return { ok: false, reason: 'rate_limited_phone' }
  const ipOk = withinLimit(`ip:${ip}`, MAX_SENDS_PER_IP)
  if (!ipOk) return { ok: false, reason: 'rate_limited_ip' }
  return { ok: true }
}

/** Test-only reset of the in-memory rate-limit store. */
export function __resetOtpRateLimitForTests(): void {
  sendAttempts.clear()
}
