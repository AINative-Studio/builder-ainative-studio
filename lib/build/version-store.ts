/**
 * Per-company deploy version index (#62) — durable metadata for the Versions list
 * + one-click rollback on the Live dashboard.
 *
 * WHY: Railway keeps the per-service DEPLOYMENT history (ids, statuses, timestamps,
 * and — for GitHub-sourced services — git meta), which `lib/build/railway-deploy.ts`
 * now queries via listDeployments(). But that history does NOT reliably carry the
 * human "commit message" that is Cody's summary of what a given deploy changed
 * (image-sourced services have no git meta at all). So we persist a per-company
 * version index in ZeroDB (`build_versions`) that maps a Railway deploymentId →
 * { message, commitSha }, recorded when Cody ships a change. On read, we JOIN the
 * live Railway history with this index so every version shows a real message + SHA,
 * and the metadata survives restarts (acceptance: "version index persisted per
 * company (survives restarts)").
 *
 * This mirrors the `build_tasks` (task-store.ts) + `build_chat` (chat-store.ts)
 * ZeroDB stores that landed on main: same {owner, company} scope key, same pure/IO
 * split so the join + fallback logic is unit-testable without a network.
 */

import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import type { RailwayDeployment } from '@/lib/build/railway-deploy'

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const TABLE_NAME = 'build_versions'

/** Hard cap on how many version-index rows a single load returns. */
export const MAX_LOAD_VERSIONS = 100

/** A persisted version-index entry: Cody's metadata for one Railway deployment. */
export interface VersionMeta {
  /** Railway deployment id this metadata describes (the join key). */
  deploymentId: string
  /** Owner+company scope key this entry belongs to. */
  scopeKey: string
  /** Cody's commit-style summary of what this deploy changed. */
  message?: string
  /** Git commit SHA (short), when known. */
  commitSha?: string
  /** ISO timestamp recorded. */
  createdAt: string
}

/**
 * A version shown in the UI — a Railway deployment JOINED with our persisted
 * metadata. Newest-first; exactly one carries `current` (the live deploy).
 */
export interface AppVersion {
  /** Railway deployment id — the rollback target. */
  deploymentId: string
  /** Normalized Railway status (live | success | building | failed | removed). */
  status: RailwayDeployment['status']
  /** Commit-style message (persisted metadata preferred, then Railway git meta). */
  message: string
  /** Short git SHA, when known. */
  commitSha?: string
  /** ISO created timestamp. */
  createdAt?: string
  /** True for the deployment currently serving the live site. */
  current: boolean
  /** Whether this version can be rolled back to (a completed, non-current deploy). */
  canRollback: boolean
}

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}

// ---------------------------------------------------------------------------
// PURE LOGIC (no I/O) — unit-testable directly
// ---------------------------------------------------------------------------

/**
 * Resolve the durable scope key for a company's version index from a session +
 * company slug. Reuses the chat/task owner-key derivation so a founder's versions
 * key identically to their chat + tasks (same owner, same company). Pure.
 */
export function versionScopeKey(
  session: Parameters<typeof deriveOwnerKey>[0],
  companySlug: string,
): string {
  return chatScopeKey(deriveOwnerKey(session), companySlug)
}

/**
 * Coerce a raw ZeroDB row into a VersionMeta, or null when it has no usable
 * deploymentId. Pure.
 */
export function coerceVersionMeta(raw: any, scopeKey = ''): VersionMeta | null {
  const rd = raw?.row_data || raw
  if (!rd) return null
  const deploymentId = String(rd.deployment_id || rd.deploymentId || '').trim()
  if (!deploymentId) return null
  return {
    deploymentId,
    scopeKey: String(rd.scope_key || rd.scopeKey || scopeKey),
    message: rd.message ? String(rd.message).slice(0, 300) : undefined,
    commitSha: rd.commit_sha || rd.commitSha ? String(rd.commit_sha || rd.commitSha).slice(0, 12) : undefined,
    createdAt: String(rd.created_at || rd.createdAt || new Date().toISOString()),
  }
}

/**
 * Build a lookup of deploymentId → VersionMeta, keeping the NEWEST row per id
 * (latest-wins, so a corrected message supersedes an earlier one). Pure.
 */
export function indexMetaById(rows: VersionMeta[]): Map<string, VersionMeta> {
  const map = new Map<string, VersionMeta>()
  for (const m of Array.isArray(rows) ? rows : []) {
    if (!m?.deploymentId) continue
    const prev = map.get(m.deploymentId)
    if (!prev || (m.createdAt || '').localeCompare(prev.createdAt || '') > 0) {
      map.set(m.deploymentId, m)
    }
  }
  return map
}

/**
 * The honest fallback message for a deployment that has neither persisted
 * metadata nor Railway git meta — never a fabricated feature summary. Pure.
 */
export function fallbackMessage(index: number, total: number): string {
  // Oldest deploy of a brand-new company: "v1" (acceptance req 6 empty state).
  if (total <= 1) return 'v1 · initial deploy'
  const versionNo = total - index // newest = highest
  return `v${versionNo} · deploy`
}

/**
 * JOIN Railway deployments with the persisted metadata index into the UI Versions
 * list (#62). For each deployment (already newest-first, with the live one flagged
 * by markCurrentDeployment): prefer the persisted message/SHA, then Railway's own
 * git meta, then an honest "vN · deploy" fallback. Computes canRollback (a
 * completed, non-current deploy). Pure — the whole join is unit-testable.
 *
 * @param deployments  Railway deployments, newest-first, `current` already set.
 * @param metaIndex    deploymentId → persisted VersionMeta.
 */
export function joinVersions(
  deployments: RailwayDeployment[],
  metaIndex: Map<string, VersionMeta>,
): AppVersion[] {
  const list = Array.isArray(deployments) ? deployments : []
  const total = list.length
  return list.map((d, i) => {
    const meta = metaIndex.get(d.id)
    const message =
      (meta?.message && meta.message.trim()) ||
      (d.message && d.message.trim()) ||
      fallbackMessage(i, total)
    const commitSha = meta?.commitSha || d.commitSha
    const current = !!d.current
    // A version can be rolled back to only if it is a completed prior deploy
    // (success/live) that is NOT the one already live.
    const canRollback = !current && (d.status === 'success' || d.status === 'live')
    return {
      deploymentId: d.id,
      status: d.status,
      message,
      commitSha,
      createdAt: d.createdAt,
      current,
      canRollback,
    }
  })
}

/**
 * The honest single-version empty state (#62 req 5): when a company has exactly
 * one (or zero) deploys, synthesize a "v1 · current" version so the panel is never
 * blank and never implies a history that doesn't exist. Used when Railway history
 * is unavailable/disabled but the company IS live. Pure.
 */
export function singleVersionFallback(deploymentId?: string): AppVersion[] {
  return [
    {
      deploymentId: deploymentId || 'v1',
      status: 'live',
      message: 'v1 · initial deploy',
      current: true,
      canRollback: false,
    },
  ]
}

// ---------------------------------------------------------------------------
// ZeroDB I/O — isolated from the pure logic above
// ---------------------------------------------------------------------------

async function zerodbRequest(
  method: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<any> {
  const url = `${ZERODB_API}${path}`
  const timeoutMs = opts.timeoutMs ?? 12_000
  const retries = opts.retries ?? 0
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        if (attempt < retries && (res.status === 401 || res.status === 429 || res.status >= 500)) continue
        return null
      }
      return await res.json()
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) throw lastErr
  return null
}

/**
 * Record (or update) Cody's metadata for a deployment (#62). Called when a change
 * ships, so the Versions list shows a real commit-style message + SHA even for
 * image-sourced services with no Railway git meta. Best-effort: returns the saved
 * VersionMeta on success, null on any failure (never throws). Latest row wins on
 * read, so re-recording a corrected message supersedes the earlier one.
 */
export async function recordVersion(
  scopeKey: string,
  input: { deploymentId: string; message?: string; commitSha?: string },
): Promise<VersionMeta | null> {
  const deploymentId = String(input?.deploymentId || '').trim()
  if (!scopeKey || !deploymentId) return null
  const now = new Date().toISOString()
  const row = {
    deployment_id: deploymentId,
    scope_key: scopeKey,
    message: input.message ? String(input.message).slice(0, 300) : '',
    commit_sha: input.commitSha ? String(input.commitSha).slice(0, 12) : '',
    created_at: now,
  }
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
      { row_data: row },
    )
    if (!result) return null
    return coerceVersionMeta(row, scopeKey)
  } catch (e) {
    console.warn('[version-store] recordVersion failed:', (e as Error)?.name || e)
    return null
  }
}

/**
 * Load the persisted metadata index for a scope, as a deploymentId → VersionMeta
 * map (newest row per id). Returns an EMPTY map on empty / failure — an honest
 * absence of metadata (the join then falls back to Railway git meta / "vN"),
 * never fabricated.
 */
export async function loadVersionIndex(scopeKey: string): Promise<Map<string, VersionMeta>> {
  if (!scopeKey) return new Map()
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
      { filters: { scope_key: scopeKey }, limit: MAX_LOAD_VERSIONS },
      { retries: 1 },
    )
    const rows: any[] = result?.data || []
    const metas = rows
      .map((r) => coerceVersionMeta(r, scopeKey))
      .filter((m): m is VersionMeta => m !== null)
    return indexMetaById(metas)
  } catch (e) {
    console.warn('[version-store] loadVersionIndex failed:', (e as Error)?.name || e)
    return new Map()
  }
}
