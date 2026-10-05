/**
 * Build-chat persistence (#52) — persist the "Ask Cody anything" conversation on
 * the Live dashboard across sessions, and give Cody conversational memory.
 *
 * PROBLEM (verified): the Live chat lived only in React state (lost on reload),
 * and /api/build/ask sent a single question to Claude (no history → amnesia).
 *
 * This module is the durable store. It follows the exact ZeroDB rows pattern used
 * by app-registry.ts (table: builder_build_chat), so the thread survives restarts
 * and re-logins, and is shareable/queryable. Best-effort throughout: a store/load
 * failure NEVER breaks the chat — it degrades to the old in-memory behaviour.
 *
 * KEY SCHEME — a conversation is scoped to {owner}:{slug}:
 *   owner = the signed-in user's email (cross-device persistence once auth #49 lands),
 *           or a guest session id (survives reload for anonymous founders).
 *   slug  = the company/app slug (companySlug|chatId), so each company has its own thread.
 * Turns are appended one row each and read back ordered by createdAt (append-only,
 * matching the registry's latest-wins read style but keeping ALL rows for a key).
 */

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_build_chat'

/** Max turns we keep/return for a conversation — bounds reads and prompt size. */
export const MAX_TURNS = 200
/** Default number of recent turns to feed back to Cody as context. */
export const DEFAULT_HISTORY_TURNS = 12

export type ChatRole = 'user' | 'cody'

export interface ChatTurn {
  role: ChatRole
  text: string
  /** ISO timestamp — used to order the thread on read. */
  createdAt?: string
}

interface StoredRow extends ChatTurn {
  /** {owner}:{slug} — the conversation this turn belongs to. */
  key: string
  slug: string
  owner: string
}

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

/**
 * Build the conversation key from an owner (user email or guest id) and a company
 * slug. Both are normalized (trimmed, lowercased) so the same founder always maps
 * to the same thread regardless of casing/whitespace. Returns '' when either part
 * is missing — callers treat that as "not persistable" (degrade to in-memory).
 */
export function chatKey(owner: string, slug: string): string {
  const o = String(owner || '').trim().toLowerCase()
  const s = String(slug || '').trim().toLowerCase()
  if (!o || !s) return ''
  return `${o}:${s}`
}

/** Coerce/clip an arbitrary role to a valid ChatRole ('cody' by default). */
function normRole(role: unknown): ChatRole {
  return role === 'user' ? 'user' : 'cody'
}

/**
 * Persist a single turn (user OR cody) for a conversation. Fire-and-forget:
 * returns true on a successful write, false on any failure (never throws). No-op
 * (false) when unconfigured, the key is empty, or the text is blank.
 */
export async function appendTurn(key: string, turn: ChatTurn): Promise<boolean> {
  const text = String(turn?.text || '').trim()
  if (!configured() || !key || !text) return false
  const [owner, slug] = key.split(':')
  const row: StoredRow = {
    key,
    owner: owner || '',
    slug: slug || '',
    role: normRole(turn.role),
    text: text.slice(0, 8000),
    createdAt: turn.createdAt || new Date().toISOString(),
  }
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ row_data: row }),
      signal: AbortSignal.timeout(10000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Persist a user+cody exchange in order. Convenience wrapper over appendTurn used
 * by /api/build/ask after it gets Cody's answer. Best-effort; returns whether both
 * writes succeeded. A blank part is skipped (so a failed answer still records the
 * question).
 */
export async function appendExchange(key: string, question: string, answer: string): Promise<boolean> {
  if (!key) return false
  const now = Date.now()
  const okUser = await appendTurn(key, { role: 'user', text: question, createdAt: new Date(now).toISOString() })
  // +1ms so the answer always sorts AFTER the question even at identical wall-clock.
  const okCody = answer?.trim()
    ? await appendTurn(key, { role: 'cody', text: answer, createdAt: new Date(now + 1).toISOString() })
    : false
  return okUser && okCody
}

/**
 * Load the full conversation for a key, oldest-first. Returns [] on any error, when
 * unconfigured, or for an empty key — the honest empty state for a brand-new company
 * (no fabricated history). Clipped to the last MAX_TURNS.
 */
export async function loadConversation(key: string): Promise<ChatTurn[]> {
  if (!configured() || !key) return []
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) return []
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const turns: ChatTurn[] = rows
      .map((r: { row_data?: StoredRow }) => r.row_data)
      .filter((rd: StoredRow | undefined): rd is StoredRow => !!rd && rd.key === key && !!rd.text)
      .map((rd: StoredRow) => ({ role: normRole(rd.role), text: rd.text, createdAt: rd.createdAt }))
    turns.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    return turns.slice(-MAX_TURNS)
  } catch {
    return []
  }
}

/**
 * Turn a stored conversation into the recent-history `messages` array Cody needs
 * for context. Maps our roles onto chat-completion roles (cody → assistant) and
 * keeps only the last N turns so the prompt stays bounded. Blank turns are dropped.
 */
export function toMessages(
  turns: ChatTurn[],
  limit: number = DEFAULT_HISTORY_TURNS,
): { role: 'user' | 'assistant'; content: string }[] {
  const recent = (turns || [])
    .filter((t) => t && String(t.text || '').trim())
    .slice(-Math.max(0, limit))
  return recent.map((t) => ({
    role: t.role === 'user' ? 'user' : 'assistant',
    content: String(t.text).trim(),
  }))
}
