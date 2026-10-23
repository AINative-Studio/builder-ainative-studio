/**
 * Context Budget Manager <-> real chat flow wiring (#1195).
 *
 * The Context Budget Manager (service + API routes + dashboard UI) shipped
 * under GitHub issue #20 but was only ever exercised from a standalone demo
 * page (app/context-budget-demo/page.tsx) with hardcoded
 * `demo-session-*`/`demo-user` IDs — it never touched a real founder
 * conversation. This module is the integration point: it lets the real
 * chat route (app/api/chat-ws/route.ts) track the REAL session's growing
 * message history against the REAL budget service/DB, and trim the
 * messages actually sent to the LLM when the budget is exhausted.
 *
 * Hard requirement (chat generation is the single most important path in
 * this app): this must be fail-open. Any failure in the budget service
 * (DB not configured, DB down, a bug in the service) must never throw,
 * never block, and never change what the LLM sees beyond what trimming
 * would already be doing. Every public function here returns a safe
 * fallback on error, and never rejects.
 */

import { estimateTokens } from '@/lib/services/token-counter.service'
import { contextBudgetService } from '@/lib/services/context-budget.service'
import { logger } from '@/lib/logger'
import type { ContextBudget } from '@/lib/types/context-budget'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export interface ChatBudgetStatus {
  total: number
  used: number
  remaining: number
  usagePercentage: number
  isWarning: boolean
  isCritical: boolean
}

export interface ApplyChatBudgetResult {
  /** The messages to actually send to the LLM — possibly trimmed. */
  messages: ChatMessage[]
  /** Real budget status, or null if the budget check itself failed/timed out. */
  budget: ChatBudgetStatus | null
  /** True if messages were trimmed to fit the budget. */
  trimmed: boolean
  /** How many oldest messages were dropped. */
  droppedCount: number
}

// Never let a slow/hung budget-service call add latency to the single most
// important path in the app. 400ms is generous relative to the dashboard's
// own documented ~50ms budget-update target, but still a hard ceiling.
const BUDGET_CHECK_TIMEOUT_MS = 400

// A single-call budget's "history" item name — one row per session, kept in
// sync (reloaded) across turns rather than one row per message. Mirrors how
// the real chat route already treats `previousMessages` as the whole history
// blob for a given chatId.
const HISTORY_ITEM_NAME = 'conversation-history'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

function toChatBudgetStatus(budget: ContextBudget): ChatBudgetStatus {
  return {
    total: budget.total,
    used: budget.used,
    remaining: budget.remaining,
    usagePercentage: budget.usagePercentage,
    isWarning: budget.isWarning,
    isCritical: budget.isCritical,
  }
}

/**
 * Track the real session's conversation history against the real budget
 * service, and trim `previousMessages` down to fit when the budget is
 * exhausted (critical / insufficient remaining tokens).
 *
 * Fail-open: on ANY error (DB unavailable, service throws, timeout), this
 * resolves with the original, untrimmed messages and `budget: null` — chat
 * generation proceeds exactly as it did before this wiring existed.
 */
export async function applyChatBudget(
  sessionId: string,
  userId: string,
  previousMessages: ChatMessage[]
): Promise<ApplyChatBudgetResult> {
  const fallback: ApplyChatBudgetResult = {
    messages: previousMessages,
    budget: null,
    trimmed: false,
    droppedCount: 0,
  }

  // No history yet (new chat) — nothing to track or trim. Skip the DB
  // round-trip entirely rather than doing a no-op load.
  if (!sessionId || !userId || previousMessages.length === 0) {
    return fallback
  }

  try {
    return await withTimeout(
      trackAndTrim(sessionId, userId, previousMessages),
      BUDGET_CHECK_TIMEOUT_MS
    )
  } catch (error) {
    logger.warn('Context budget check failed — continuing with untrimmed history', {
      sessionId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return fallback
  }
}

async function trackAndTrim(
  sessionId: string,
  userId: string,
  previousMessages: ChatMessage[]
): Promise<ApplyChatBudgetResult> {
  const historyText = previousMessages.map((m) => m.content).join('\n')
  const tokenCost = estimateTokens(historyText)

  // Record/refresh the real history size for this real session. `load` is
  // idempotent for an existing item (the service bumps access count instead
  // of double-counting), so calling this every turn is safe.
  await contextBudgetService.trackItem(
    sessionId,
    userId,
    {
      type: 'history',
      name: HISTORY_ITEM_NAME,
      tokenCost,
      priority: 'high',
      status: 'loaded',
    },
    'load'
  )

  const budget = await contextBudgetService.getBudget(sessionId, userId)
  const status = toChatBudgetStatus(budget)

  // Plenty of room — nothing to trim.
  if (!budget.isCritical && budget.remaining > 0) {
    return { messages: previousMessages, budget: status, trimmed: false, droppedCount: 0 }
  }

  // Budget is critical or over: drop the oldest messages first (preserving
  // the most recent conversational context, which matters most for a
  // follow-up generation) until the remaining history fits inside the
  // session's real remaining token budget. Always keep at least the most
  // recent exchange — never trim down to nothing, since an empty history is
  // a worse failure mode than slightly over-budget context.
  const MIN_KEPT_MESSAGES = 2
  let trimmedMessages = previousMessages
  let droppedCount = 0

  // Reserve the same budget share the stored history item already consumed;
  // trim text, not just the count, so the token estimate actually shrinks.
  let budgetForHistory = Math.max(budget.total - (budget.used - tokenCost), 0)

  while (
    trimmedMessages.length > MIN_KEPT_MESSAGES &&
    estimateTokens(trimmedMessages.map((m) => m.content).join('\n')) > budgetForHistory
  ) {
    trimmedMessages = trimmedMessages.slice(1)
    droppedCount += 1
  }

  if (droppedCount > 0) {
    logger.info('Context budget: trimmed conversation history for chat', {
      sessionId,
      userId,
      droppedCount,
      usagePercentage: status.usagePercentage,
    })
  }

  return {
    messages: trimmedMessages,
    budget: status,
    trimmed: droppedCount > 0,
    droppedCount,
  }
}
