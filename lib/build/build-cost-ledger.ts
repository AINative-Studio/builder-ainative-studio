/**
 * Build cost ledger (#886) — persists the real estimated_cost chat-ws/route.ts
 * already computes at generation time.
 *
 * Before this: route.ts computed a real `tokenUsage.estimated_cost` at several
 * points (the Claude direct path, the AINative/Meta fallback paths, the
 * multi-pass chunking path) and only ever `console.log`'d it. The one
 * near-miss, storeFilesV2(responseId, parsedFiles, { usage: tokenUsage }),
 * resolves to lib/preview-store-v2.ts's in-memory Map with a 2-hour TTL — not
 * a durable ledger, so the number was unrecoverable minutes after the request
 * finished.
 *
 * Why this matters: the freemium gate (lib/build/build-credits.ts) counts
 * flat builds (3 free / 80 starter) completely decoupled from real computed
 * cost — a one-line prompt and a 16K-token build cost exactly "1 build"
 * against quota. Without a durable per-build cost row there is no way to
 * reconcile real spend against that flat-build business model after the
 * fact.
 *
 * Persisted to ZeroDB (append-only rows, latest-wins reads — no ORM), the
 * SAME convention as build-credits.ts and app-registry.ts: a dedicated
 * table, a POST of { row_data }, fail-OPEN (never block/throw on a metering
 * outage) and a short fetch timeout so a slow ZeroDB never holds up the
 * request's fire-and-forget persistence block.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_build_cost_ledger'

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

/** Shape of the usage/cost object route.ts already builds as `tokenUsage`. */
export interface TokenUsageLike {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  total_tokens?: number
  estimated_cost?: number
}

export interface BuildCostEntry {
  /** The chat/build id (responseId in route.ts) — ties the cost back to a specific generation. */
  chatId: string
  /** Signed-in founder's resolved identity, or 'anonymous' — matches route.ts's `userId` resolution (#61). */
  ownerId: string
  /** The model actually used for generation (requestedModel/usedModel, already defaulted upstream). */
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  /** 'success' | 'degraded' | 'error' — mirrors the persistGeneration status values used elsewhere in route.ts. */
  status: string
  generationTimeMs?: number
}

/**
 * Persist one build's real computed cost as an append-only ZeroDB row.
 * Best-effort — a failed write never throws or blocks generation (matching
 * every other durable write in this codebase). Returns true only if the row
 * was actually written, so callers/tests can assert persistence rather than
 * just "didn't throw".
 */
export async function recordBuildCost(entry: BuildCostEntry): Promise<boolean> {
  if (!configured()) return false
  if (!entry.chatId) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: {
          chatId: entry.chatId,
          ownerId: entry.ownerId || 'anonymous',
          model: entry.model,
          inputTokens: entry.inputTokens || 0,
          outputTokens: entry.outputTokens || 0,
          totalTokens: entry.totalTokens || 0,
          estimatedCostUsd: entry.estimatedCostUsd || 0,
          status: entry.status,
          generationTimeMs: entry.generationTimeMs ?? null,
          createdAt: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(12000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Build a BuildCostEntry from route.ts's existing `tokenUsage` shape — keeps
 * the call site a one-liner and the null-coalescing in one place.
 */
export function buildCostEntryFromTokenUsage(
  chatId: string,
  ownerId: string,
  model: string,
  tokenUsage: TokenUsageLike | undefined,
  status: string,
  generationTimeMs?: number,
): BuildCostEntry {
  return {
    chatId,
    ownerId,
    model,
    inputTokens: tokenUsage?.input_tokens || 0,
    outputTokens: tokenUsage?.output_tokens || 0,
    totalTokens: tokenUsage?.total_tokens || 0,
    estimatedCostUsd: tokenUsage?.estimated_cost || 0,
    status,
    generationTimeMs,
  }
}

/**
 * Read back a page of cost rows, optionally filtered to one owner. Best-effort
 * — returns [] on any error rather than throwing, consistent with every other
 * read in this module family (build-credits.ts, app-registry.ts).
 */
export async function listBuildCosts(ownerId?: string): Promise<BuildCostEntry[]> {
  if (!configured()) return []
  try {
    const res = await fetch(rowsUrl(), {
      method: 'GET',
      headers: headers(),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    const rows: Array<{ row_data?: any }> = data?.rows || data?.data || []
    const entries = rows
      .map((r) => r?.row_data)
      .filter((r): r is any => Boolean(r))
      .map((r) => ({
        chatId: r.chatId,
        ownerId: r.ownerId,
        model: r.model,
        inputTokens: r.inputTokens || 0,
        outputTokens: r.outputTokens || 0,
        totalTokens: r.totalTokens || 0,
        estimatedCostUsd: r.estimatedCostUsd || 0,
        status: r.status,
        generationTimeMs: r.generationTimeMs ?? undefined,
      }))
    return ownerId ? entries.filter((e) => e.ownerId === ownerId) : entries
  } catch {
    return []
  }
}
