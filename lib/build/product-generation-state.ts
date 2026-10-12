/**
 * Durable link between a company-product generation attempt and its chatId
 * (issue #660 follow-up) — closes the registration-durability gap found live
 * investigating why NONE of a real account's 20 companies ever got a working
 * product, despite /api/build/company-product's background generation
 * genuinely succeeding, repeatedly, for several of them.
 *
 * Root cause: runProductGeneration (company-product/route.ts) is an unawaited
 * background task tied to the live server process. chat-ws's own
 * saveGeneration() call is awaited BEFORE it emits 'complete' — so by the
 * time this route's reader loop even sees a chatId, the generated code is
 * already durably persisted in the `generations` table, independent of this
 * process's survival. But the FINAL step, registerApp({slug: productSlug,
 * chatId}), only happens after the reader loop keeps running long enough to
 * observe 'complete' too — and a Railway redeploy (this session shipped
 * ~20 of them) kills the container mid-loop. Confirmed live: a real Dispatch
 * product generation (chat_id WpyFu_-dMZ6s8SVdMfSxR) produced correct,
 * primitive-wired code, safely persisted — but was NEVER registered, so
 * /build/dispatch-product 404'd forever with the real work silently wasted.
 *
 * Fix: write this pending record the MOMENT a chatId is known (before the
 * risky long wait for 'complete'), so a later request for the same
 * productSlug can find the in-flight chatId, check whether its generation is
 * ALREADY done in `generations` (saveGeneration already ran, per the ordering
 * above), and finish registration immediately — without re-running an
 * expensive generation that may have already succeeded once and just never
 * got linked.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_product_generation_state'

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

export interface ProductGenerationState {
  productSlug: string
  chatId: string
  status: 'pending' | 'registered'
  createdAt: string
}

/** Mirrors app-registry.ts's ensureTable pattern — best-effort, idempotent. */
async function ensureTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ table_name: TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Table might already exist, or the create call itself failed — either
    // way, fall through to the real write and let ITS result be authoritative.
  }
}

/**
 * Record that {productSlug} maps to {chatId}, as soon as chatId is known —
 * BEFORE waiting for the generation to fully finish streaming. Never throws;
 * a write failure just means resumption won't find this attempt later
 * (fails toward "regenerate", never toward losing already-good state).
 */
export async function recordPendingProductGeneration(productSlug: string, chatId: string): Promise<void> {
  if (!configured() || !productSlug || !chatId) return
  try {
    await ensureTable()
    const row: ProductGenerationState = { productSlug, chatId, status: 'pending', createdAt: new Date().toISOString() }
    await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ row_data: row }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    // Best-effort — see doc comment.
  }
}

/** Mark a pending attempt registered, once registerApp has actually run. */
export async function markProductGenerationRegistered(productSlug: string, chatId: string): Promise<void> {
  if (!configured() || !productSlug || !chatId) return
  try {
    const row: ProductGenerationState = { productSlug, chatId, status: 'registered', createdAt: new Date().toISOString() }
    await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ row_data: row }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    // Best-effort — see doc comment.
  }
}

/**
 * Resolve the most recent generation attempt for {productSlug} — latest row
 * wins, matching every other table in this codebase's append-only pattern.
 * Null when never attempted, when ZeroDB is unconfigured, or on any error
 * (fails toward "attempt a fresh generation," never toward a stale result).
 *
 * @deprecated Use {@link resolvePendingProductGenerationVerified} at any call
 * site that gates a billable regeneration decision on the result (#1051).
 * This function cannot distinguish "confirmed no pending attempt" from "the
 * read itself failed" — both return a bare `null`, and a caller treating
 * that as "nothing pending, safe to generate fresh" pays for a duplicate
 * generation on a transient registry-read failure or (once this table
 * crosses 1000 rows) the same `?limit=1000` read-cap gap #1041 fixed for
 * `company-app`/`company-product`. Kept only for any caller that genuinely
 * doesn't spend money on the result.
 */
export async function resolvePendingProductGeneration(productSlug: string): Promise<ProductGenerationState | null> {
  const { state } = await resolvePendingProductGenerationVerified(productSlug)
  return state
}

/**
 * Same lookup as {@link resolvePendingProductGeneration}, but honest about
 * WHY a miss happened (#1051 — same risk class #1041 fixed for
 * `resolveApp`/`resolveAppVerified`): `verified: true` means this is a
 * CONFIRMED absence of a pending attempt, safe to proceed to a fresh
 * generation; `verified: false` means the read itself failed (unconfigured,
 * non-ok response, timeout, or a parse error) and the caller does not
 * actually know whether an in-flight/orphaned attempt exists. A caller that
 * gates a billable regeneration on this result must fail CLOSED on
 * `verified: false` — same pattern as `resolveAppVerified`.
 */
export async function resolvePendingProductGenerationVerified(
  productSlug: string,
): Promise<{ state: ProductGenerationState | null; verified: boolean }> {
  if (!productSlug) return { state: null, verified: true }
  if (!configured()) return { state: null, verified: false }
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { state: null, verified: false }
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const matches = rows
      .map((r: { row_data?: ProductGenerationState }) => r.row_data)
      .filter((rd: ProductGenerationState | undefined): rd is ProductGenerationState => rd?.productSlug === productSlug)
    if (!matches.length) return { state: null, verified: true }
    matches.sort((a: ProductGenerationState, b: ProductGenerationState) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return { state: matches[0], verified: true }
  } catch {
    return { state: null, verified: false }
  }
}
