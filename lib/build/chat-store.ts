/**
 * Cody chat persistence (#52) — the Live-dashboard conversation survives reload
 * and re-login, and Cody gets conversational memory.
 *
 * WHY: `components/build/screens/Live.tsx` held the chat in ephemeral React
 * `useState`, and `/api/build/ask` was stateless (only the current question was
 * sent to Claude). So the conversation vanished on refresh and follow-ups like
 * "make it cheaper" had no context. Polsia persists the agent conversation; we
 * didn't. This module backs the conversation with our own primitive — a ZeroDB
 * `build_chat` table — so it's durable and owned.
 *
 * SCOPE KEY: each turn is keyed by {ownerKey}::{companySlug}, where ownerKey is
 * the authenticated user's email when signed in, else a stable guest key derived
 * from the guest session (guest-<uuid>@example.com). The guest session cookie
 * survives reload, so a guest's thread is restored on refresh; once they log in,
 * the migrate flow (#49) re-owns their companies and future turns key by email.
 *
 * The heavy I/O (ZeroDB) is isolated from the pure logic (scope key derivation,
 * history → messages) so the pure core can be unit-tested without a network.
 */

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const TABLE_NAME = 'build_chat'

/** A single persisted chat turn. */
export interface ChatTurn {
  /** 'user' = the founder; 'assistant' = Cody. */
  role: 'user' | 'assistant'
  /** The message text. */
  text: string
  /** ISO timestamp the turn was created (used for ordering). */
  createdAt: string
}

/** How many recent turns to feed Claude as conversational memory. */
export const DEFAULT_HISTORY_TURNS = 12
/** Hard cap on how many turns a single load returns (defends the payload size). */
export const MAX_LOAD_TURNS = 100

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}

/**
 * Derive the durable owner key for a conversation.
 *
 * - Authenticated (real account) → the user's email (lowercased).
 * - Guest / anonymous → a stable `guest:<id>` key from the guest session, so the
 *   thread survives reload for that guest. Falls back to `guest:anon` only when
 *   there is truly no session identifier at all.
 *
 * Pure and side-effect free so it can be unit-tested directly.
 */
export function deriveOwnerKey(session: {
  user?: { email?: string | null; id?: string | null; type?: string | null } | null
} | null | undefined): string {
  const user = session?.user
  const email = (user?.email || '').trim().toLowerCase()
  const isGuest = user?.type === 'guest' || /^guest-[^@]+@example\.com$/i.test(email)
  if (email && !isGuest) return email
  // Guest: prefer the stable session user id, else the synthetic guest email.
  const id = (user?.id || '').trim()
  if (id) return `guest:${id}`
  if (email) return `guest:${email}`
  return 'guest:anon'
}

/**
 * Compose the ZeroDB row key that scopes a conversation to {owner, company}.
 * A blank slug is normalized so two companies never collide, and the key is
 * stable across requests for the same owner+company.
 */
export function chatScopeKey(ownerKey: string, companySlug: string): string {
  const slug = String(companySlug || '').trim().toLowerCase() || 'untitled'
  return `${ownerKey}::${slug}`
}

/**
 * Turn stored history + the new question into the `messages` array for Claude,
 * giving Cody memory of the last N turns.
 *
 * - Keeps only the most recent `maxTurns` turns (older context is dropped).
 * - Maps our roles to Anthropic roles ('user' stays 'user', 'assistant' stays
 *   'assistant'; the persisted 'assistant' role already matches).
 * - Always appends the current question last as a 'user' turn.
 * - Collapses any accidental leading 'assistant' turn (Anthropic requires the
 *   first message to be 'user').
 *
 * Pure — no I/O — so history/window logic is unit-testable.
 */
export function buildMessagesWithHistory(
  history: ChatTurn[],
  question: string,
  maxTurns: number = DEFAULT_HISTORY_TURNS,
): { role: 'user' | 'assistant'; content: string }[] {
  const recent = (Array.isArray(history) ? history : [])
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && String(t.text || '').trim())
    .slice(-Math.max(0, maxTurns))
    .map((t) => ({ role: t.role, content: String(t.text).trim() }))

  // Anthropic requires the first message to be 'user'; drop any leading
  // assistant turns that would violate that (e.g. a truncated window).
  while (recent.length && recent[0].role === 'assistant') recent.shift()

  const messages = [...recent]
  const q = String(question || '').trim()
  if (q) messages.push({ role: 'user', content: q })
  return messages
}

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
 * Persist one turn (user or assistant) for a conversation. Fire-and-forget:
 * returns true on success, false on any failure (never throws), so a persistence
 * hiccup can't break the chat request.
 */
export async function appendChatTurn(
  scopeKey: string,
  turn: { role: 'user' | 'assistant'; text: string },
): Promise<boolean> {
  const text = String(turn?.text || '').trim()
  if (!scopeKey || !text || (turn.role !== 'user' && turn.role !== 'assistant')) return false
  try {
    const row = {
      scope_key: scopeKey,
      role: turn.role,
      text,
      created_at: new Date().toISOString(),
    }
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
      { row_data: row },
    )
    return !!result
  } catch (e) {
    console.warn('[chat-store] appendChatTurn failed:', (e as Error)?.name || e)
    return false
  }
}

/**
 * Persist a user question and Cody's answer as two turns, in order. Best-effort:
 * a failure on either is swallowed (returns false) so the chat still works.
 */
export async function saveExchange(
  scopeKey: string,
  question: string,
  answer: string,
): Promise<boolean> {
  const uOk = await appendChatTurn(scopeKey, { role: 'user', text: question })
  const aOk = await appendChatTurn(scopeKey, { role: 'assistant', text: answer })
  return uOk && aOk
}

/**
 * Load the conversation for a scope, oldest-first, capped at `limit` turns.
 * Returns [] on empty / failure — an honest empty state for a new company,
 * never fabricated history.
 */
export async function loadChat(
  scopeKey: string,
  limit: number = MAX_LOAD_TURNS,
): Promise<ChatTurn[]> {
  if (!scopeKey) return []
  const cap = Math.min(Math.max(1, limit), MAX_LOAD_TURNS)
  try {
    const result = await zerodbRequest(
      'POST',
      `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
      { filters: { scope_key: scopeKey }, limit: cap },
      { retries: 1 },
    )
    const rows: any[] = result?.data || []
    const turns: ChatTurn[] = rows
      .map((r) => r.row_data || r)
      .filter((rd) => rd && (rd.role === 'user' || rd.role === 'assistant') && rd.text)
      .map((rd) => ({
        role: rd.role as 'user' | 'assistant',
        text: String(rd.text),
        createdAt: String(rd.created_at || ''),
      }))
    // Oldest-first for natural display + correct history windowing.
    turns.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return turns.slice(-cap)
  } catch (e) {
    console.warn('[chat-store] loadChat failed:', (e as Error)?.name || e)
    return []
  }
}
