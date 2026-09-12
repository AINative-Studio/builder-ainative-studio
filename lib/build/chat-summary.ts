/**
 * Chat handoff summary (#608) — a periodically-regenerated, human-readable
 * "where we left off" for an ongoing company build's chat thread.
 *
 * Real gap (Enterprise customer feedback, WhatsApp, 2026-09-09, "dedux"):
 * "it will be good to create occasional convo summary or handoff file so I
 * don't have to start fresh with cody every day or everytime I restart."
 * chat-store.ts (#52) persists every turn, but buildMessagesWithHistory()
 * only ever feeds Claude a raw sliding window of the last N turns — nothing
 * ever summarized the conversation for a HUMAN to read back. A founder
 * reopening the dashboard after a day had to scroll/re-read the raw
 * transcript to remember where things stood.
 *
 * Storage: append-only + latest-wins, mirroring app-registry.ts's own
 * pattern (POST a new row per regeneration, read back "latest by
 * created_at") rather than an update-in-place — sidesteps the real ZeroDB
 * update-by-filter pitfall task-store.ts's updateTask hit (#698 follow-up:
 * a bulk PUT filtered on more than one row_data key never actually matches).
 *
 * Regeneration policy: only when enough NEW turns have accumulated since the
 * last summary (default 6) — an LLM call on every single chat turn would be
 * wasteful; the summary is meant to bridge a real gap in time/turns, not
 * mirror every message.
 */

import { getClaudeCompletion } from '@/lib/build/claude-completion'
import type { ChatTurn } from '@/lib/build/chat-store'

const ZERODB_API = process.env.ZERODB_API_URL || 'https://api.ainative.studio/api'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const TABLE_NAME = 'build_chat_summaries'

/** Minimum NEW turns since the last summary before regenerating. Keeps the
 *  LLM call cost proportional to real conversation growth, not every turn. */
export const MIN_NEW_TURNS_TO_REGENERATE = 6

export interface ChatSummary {
  summary: string
  /** Total turn count the summary covers, so we can tell how many are new. */
  turnsCovered: number
  updatedAt: string
}

function getApiKey(): string {
  return process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || process.env.API_Key || ''
}

async function zerodbRequest(method: string, path: string, body?: unknown): Promise<any> {
  try {
    const res = await fetch(`${ZERODB_API}${path}`, {
      method,
      headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Whether a fresh summary is worth generating: no summary exists yet (and
 * there's at least one turn), or enough new turns have accumulated since the
 * last one. Pure.
 */
export function shouldRegenerateSummary(totalTurns: number, existing: ChatSummary | null): boolean {
  if (totalTurns === 0) return false
  if (!existing) return true
  return totalTurns - existing.turnsCovered >= MIN_NEW_TURNS_TO_REGENERATE
}

/**
 * Build the prompt for summarizing a chat thread into a short handoff note.
 * PURE — string assembly only.
 */
export function buildSummaryPrompt(companyName: string, idea: string, turns: ChatTurn[]): { system: string; user: string } {
  const system =
    `You write short, honest "where we left off" handoff notes for a founder returning to their ` +
    `AI co-founder Cody after time away. Summarize what was discussed and decided — not a transcript, ` +
    `a real summary a busy founder can read in 10 seconds and immediately know where things stand. ` +
    `2-4 sentences. Plain text, no markdown. Mention any concrete change requests and their real outcome ` +
    `if known (shipped/in progress/still needs a decision) — never invent an outcome that wasn't stated.`

  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'Founder' : 'Cody'}: ${t.text}`)
    .join('\n')

  const user =
    `Company: ${companyName}\nIdea: ${idea}\n\nCONVERSATION:\n${transcript}\n\n` +
    `Write the handoff summary now.`

  return { system, user }
}

/** Real LLM call that summarizes a chat thread. Never fabricates on failure —
 *  returns null so the caller can fall back to no summary. */
export async function generateChatSummary(
  companyName: string,
  idea: string,
  turns: ChatTurn[],
): Promise<string | null> {
  if (!turns.length) return null
  const claude = getClaudeCompletion()
  if (!claude) return null
  const { system, user } = buildSummaryPrompt(companyName, idea, turns)
  try {
    const res = await claude.client.messages.create(
      { model: claude.model, max_tokens: 250, temperature: 0.4, system, messages: [{ role: 'user', content: user }] },
      { signal: AbortSignal.timeout(20_000) },
    )
    const text = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
    return text || null
  } catch {
    return null
  }
}

/** Persist a freshly-generated summary. Append-only + latest-wins. */
export async function saveChatSummary(scopeKey: string, summary: string, turnsCovered: number): Promise<boolean> {
  if (!scopeKey || !summary) return false
  const result = await zerodbRequest(
    'POST',
    `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/rows`,
    { row_data: { scope_key: scopeKey, summary: summary.slice(0, 2000), turns_covered: turnsCovered, created_at: new Date().toISOString() } },
  )
  return !!result
}

/** Load the latest summary for a scope, or null if none exists / on failure. */
export async function loadChatSummary(scopeKey: string): Promise<ChatSummary | null> {
  if (!scopeKey) return null
  const result = await zerodbRequest(
    'POST',
    `/v1/projects/${PROJECT_ID}/database/tables/${TABLE_NAME}/query`,
    { filters: { scope_key: scopeKey }, limit: 50 },
  )
  const rows: any[] = result?.data || []
  const parsed = rows
    .map((r) => r.row_data || r)
    .filter((rd) => rd && typeof rd.summary === 'string' && rd.summary)
    .map((rd) => ({
      summary: String(rd.summary),
      turnsCovered: Number(rd.turns_covered) || 0,
      updatedAt: String(rd.created_at || ''),
    }))
  if (!parsed.length) return null
  parsed.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  return parsed[0]
}

/**
 * Ensure a fresh summary exists for a scope's chat thread, regenerating only
 * when warranted (shouldRegenerateSummary). Best-effort, fire-and-forget from
 * the caller's perspective — never throws. Returns the summary to use right
 * now (freshly generated, or the existing one when regeneration wasn't
 * warranted or failed).
 */
export async function ensureChatSummary(
  scopeKey: string,
  companyName: string,
  idea: string,
  turns: ChatTurn[],
): Promise<ChatSummary | null> {
  if (!scopeKey) return null
  try {
    const existing = await loadChatSummary(scopeKey)
    if (!shouldRegenerateSummary(turns.length, existing)) return existing
    const fresh = await generateChatSummary(companyName, idea, turns)
    if (!fresh) return existing
    const saved = await saveChatSummary(scopeKey, fresh, turns.length)
    if (!saved) return existing
    return { summary: fresh, turnsCovered: turns.length, updatedAt: new Date().toISOString() }
  } catch {
    return null
  }
}
