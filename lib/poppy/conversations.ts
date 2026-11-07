/**
 * Poppy conversation storage (#1842) — Personal Agent Protocol 0.4.
 *
 * Mirrors the exact ensureTable-then-write, append-only / latest-wins ZeroDB
 * pattern already established in lib/build/anon-drafts.ts (and otp.ts,
 * funnel-events.ts, artifact-versions.ts): ZeroDB's `POST .../rows` is a
 * pure INSERT, never an upsert, so every state change appends a new row and
 * reads resolve the newest row per conversation id.
 *
 * Two tables:
 *   builder_poppy_conversations — one row per conversation state snapshot
 *   builder_poppy_requests      — the request-dedup index (spec section 4)
 *
 * ── REQUEST DEDUPLICATION (spec, verbatim) ─────────────────────────────────
 * "Every POST body includes an `id` chosen by the Personal Agent, which MUST
 * make it unique for the User across all its requests. To retry a request,
 * the Personal Agent sends it again to the same path with the same ID. If the
 * Company has already accepted a request with that ID, path, and body, it
 * returns the original response. Query parameters don't affect idempotency
 * matching. If the path or body is different, the Company returns
 * `request_id_conflict`."
 *
 * So this is real idempotency-key storage, not a documented intention: each
 * accepted POST records (clientId, userId, requestId, path, bodyHash,
 * status, response). A replay with a matching hash replays the ORIGINAL
 * stored response without reprocessing; a collision on the same id with a
 * different path or body returns request_id_conflict.
 *
 * Scope is per (clientId, userId) — the spec scopes id uniqueness to the
 * User, so two different Personal Agents (or two users of one agent) can
 * independently choose the same id without colliding.
 */

import { createHash } from 'crypto'
import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const CONVERSATIONS_TABLE = 'builder_poppy_conversations'
const REQUESTS_TABLE = 'builder_poppy_requests'

/** Resolved per call, not at module load — tests stub env before importing. */
function apiKey(): string {
  return getAinativeApiKey()
}

function headers(): Record<string, string> {
  const key = apiKey()
  return { Authorization: `Bearer ${key}`, 'X-API-Key': key, 'Content-Type': 'application/json' }
}

export function isPoppyStorageConfigured(): boolean {
  return Boolean(apiKey() && PROJECT_ID)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConversationStatus = 'open' | 'closed' | 'needs_human'

/** One event in a conversation's transcript (spec: GET .../events). */
export interface PoppyEvent {
  id: string
  timestamp: string
  type: 'message' | 'handoff_requested' | 'closed'
  message?: { author: { type: 'agent' | 'human' }; text: string }
  reason?: string
}

/** A conversation state snapshot, as stored in one ZeroDB row. */
export interface PoppyConversation {
  conversationId: string
  /** Ownership: the Personal Agent's client_id. */
  clientId: string
  /** Ownership: the pairwise User ID. */
  userId: string
  status: ConversationStatus
  events: PoppyEvent[]
  createdAt: string
  updatedAt: string
}

interface RawRow {
  row_id?: string
  row_data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Table bootstrap + low-level row access
// ---------------------------------------------------------------------------

async function ensureTable(table: string): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ table_name: table }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    /* table very likely already exists — same best-effort create as anon-drafts.ts */
  }
}

async function readRows<T>(table: string): Promise<T[]> {
  try {
    const res = await fetch(
      `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${table}/rows?limit=5000`,
      { headers: headers(), signal: AbortSignal.timeout(15000) },
    )
    if (!res.ok) return []
    const data = JSON.parse(await res.text())
    const rows: RawRow[] = Array.isArray(data) ? data : data.data || data.rows || []
    return rows.filter((r) => Boolean(r.row_data)).map((r) => r.row_data as T)
  } catch {
    return []
  }
}

async function appendRow(table: string, rowData: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(
      `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${table}/rows`,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ row_data: rowData }),
        signal: AbortSignal.timeout(15000),
      },
    )
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

function randomSuffix(bytes = 9): string {
  // base64url of random bytes, matching the spec's short opaque-id style
  // (cnv_8f3Kd2 / evt_7Kp2) without inventing a guessable sequence.
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Buffer.from(buf).toString('base64url')
}

export function newConversationId(): string {
  return `cnv_${randomSuffix()}`
}

export function newEventId(): string {
  return `evt_${randomSuffix(6)}`
}

// ---------------------------------------------------------------------------
// Conversation reads/writes (append-only, latest-wins — same as anon-drafts)
// ---------------------------------------------------------------------------

/**
 * Load a conversation by id, resolving the newest stored snapshot.
 *
 * Ownership is enforced by the CALLER passing the verified session identity:
 * a conversation belongs to the (clientId, userId) that started it, and a
 * mismatch must look exactly like a conversation that doesn't exist
 * (spec: `conversation_not_found`), never like a permission error — that
 * would leak the existence of another user's conversation.
 */
export async function loadConversation(
  conversationId: string,
  owner?: { clientId: string; userId: string },
): Promise<PoppyConversation | null> {
  if (!isPoppyStorageConfigured() || !conversationId) return null
  const rows = await readRows<PoppyConversation>(CONVERSATIONS_TABLE)
  const snapshot = rows
    .filter((r) => r?.conversationId === conversationId)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0]
  if (!snapshot) return null
  if (owner && (snapshot.clientId !== owner.clientId || snapshot.userId !== owner.userId)) {
    return null
  }
  return snapshot
}

/** Persist a conversation snapshot (append-only; newest wins on read). */
export async function saveConversation(conversation: PoppyConversation): Promise<boolean> {
  if (!isPoppyStorageConfigured()) return false
  await ensureTable(CONVERSATIONS_TABLE)
  return appendRow(CONVERSATIONS_TABLE, { ...conversation } as unknown as Record<string, unknown>)
}

/** Create and store a brand-new conversation with its first events. */
export async function createConversation(params: {
  clientId: string
  userId: string
  events: PoppyEvent[]
}): Promise<PoppyConversation | null> {
  const now = new Date().toISOString()
  const conversation: PoppyConversation = {
    conversationId: newConversationId(),
    clientId: params.clientId,
    userId: params.userId,
    status: 'open',
    events: params.events,
    createdAt: now,
    updatedAt: now,
  }
  const ok = await saveConversation(conversation)
  return ok ? conversation : null
}

/** Append events to a conversation and optionally change its status. */
export async function appendEvents(
  conversation: PoppyConversation,
  events: PoppyEvent[],
  status?: ConversationStatus,
): Promise<PoppyConversation | null> {
  const updated: PoppyConversation = {
    ...conversation,
    status: status ?? conversation.status,
    events: [...conversation.events, ...events],
    updatedAt: new Date().toISOString(),
  }
  const ok = await saveConversation(updated)
  return ok ? updated : null
}

// ---------------------------------------------------------------------------
// Request deduplication (spec section 4)
// ---------------------------------------------------------------------------

interface StoredRequest {
  clientId: string
  userId: string
  requestId: string
  path: string
  bodyHash: string
  responseStatus: number
  responseBody: Record<string, unknown>
  createdAt: string
}

/** Stable hash of the raw request body, so a byte-identical retry matches. */
export function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

export type DedupOutcome =
  /** Not seen before — the caller should process it, then record the result. */
  | { kind: 'new' }
  /** Seen with a matching path+body — replay the original response verbatim. */
  | { kind: 'replay'; status: number; body: Record<string, unknown> }
  /** Same id, different path or body — spec requires `request_id_conflict`. */
  | { kind: 'conflict' }

/**
 * Look up a request id for this (clientId, userId). Query parameters are
 * deliberately excluded from `path` by the caller, per the spec's "query
 * parameters don't affect idempotency matching".
 */
export async function checkRequest(params: {
  clientId: string
  userId: string
  requestId: string
  path: string
  bodyHash: string
}): Promise<DedupOutcome> {
  if (!isPoppyStorageConfigured() || !params.requestId) return { kind: 'new' }
  const rows = await readRows<StoredRequest>(REQUESTS_TABLE)
  const match = rows
    .filter(
      (r) =>
        r?.requestId === params.requestId &&
        r?.clientId === params.clientId &&
        r?.userId === params.userId,
    )
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]

  if (!match) return { kind: 'new' }
  if (match.path !== params.path || match.bodyHash !== params.bodyHash) return { kind: 'conflict' }
  return { kind: 'replay', status: match.responseStatus, body: match.responseBody }
}

/** Record an accepted request so a later retry replays this exact response. */
export async function recordRequest(params: {
  clientId: string
  userId: string
  requestId: string
  path: string
  bodyHash: string
  responseStatus: number
  responseBody: Record<string, unknown>
}): Promise<boolean> {
  if (!isPoppyStorageConfigured() || !params.requestId) return false
  await ensureTable(REQUESTS_TABLE)
  const row: StoredRequest = { ...params, createdAt: new Date().toISOString() }
  return appendRow(REQUESTS_TABLE, row as unknown as Record<string, unknown>)
}
