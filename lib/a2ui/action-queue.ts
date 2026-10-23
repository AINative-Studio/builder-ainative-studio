/**
 * A2UI agent action queue (#1193)
 *
 * The real transport for A2UI messages in this deployment is the per-chat
 * queue drained by `GET /api/a2ui/poll`. There is no A2UI WebSocket server:
 * `npm start` is plain `next start`, there is no custom `server.js`, and
 * `GET /api/a2ui` answers a websocket upgrade with 426 + a pointer at the
 * polling endpoint. So forwarding a user action "to the agent" means pushing
 * it onto that queue for the agent's poll loop to pick up.
 *
 * This module owns that queue so both sides share one store:
 *  - `POST /api/a2ui/action`  — producer (browser user actions)
 *  - `GET  /api/a2ui/poll`    — consumer (the agent's poll loop)
 *
 * Deliberately in-process. Redis is disabled repo-wide (see lib/redis.ts:
 * ioredis connection errors flooded the event loop and blocked all API
 * calls), and an A2UI preview session is a single short-lived browser↔server
 * pairing, so a module-level Map is the honest storage for it. That also
 * means a consumer must be registered on the same instance that receives the
 * action — which is exactly why delivery is reported, not assumed: a caller
 * with no attached consumer gets `delivered: false`, never a fake success.
 */

/** A2UI protocol message, matching components/a2ui/AgentConnection.tsx. */
export interface A2UIQueuedMessage {
  type: 'action' | 'render' | 'update' | 'state' | 'error'
  payload: any
  timestamp: number
  messageId: string
}

export type DeliveryFailureReason = 'no_agent_consumer'

export interface DeliveryResult {
  delivered: boolean
  /** Present only when `delivered` is true. */
  actionId?: string
  /** Present only when `delivered` is false. */
  reason?: DeliveryFailureReason
}

/**
 * Per-chat queue cap. An A2UI preview can fire actions far faster than an
 * agent drains them (a held-down button, a form re-submitting); without a cap
 * a stuck consumer would grow the queue without bound. Oldest-first eviction
 * keeps the most recent user intent, which is the one worth acting on.
 */
export const MAX_QUEUED_ACTIONS = 200

/**
 * How long a consumer registration stays valid without being refreshed. The
 * poll endpoint re-subscribes on every long-poll (30s default), so a live
 * consumer refreshes well inside this window; a browser that navigated away
 * stops refreshing and its chat stops accepting actions instead of silently
 * filling a queue nobody reads.
 */
export const CONSUMER_TTL_MS = 120_000

const queues = new Map<string, A2UIQueuedMessage[]>()
const consumers = new Map<string, number>()

function newMessageId(): string {
  // randomUUID is available on Node's global crypto (node 19+) and in browsers.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `a2ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Register (or refresh) an agent consumer for a chat. Called by the poll
 * endpoint each time the agent attaches.
 */
export function subscribeAgentConsumer(chatId: string): void {
  consumers.set(chatId, Date.now() + CONSUMER_TTL_MS)
}

/** Drop a consumer registration immediately. */
export function unsubscribeAgentConsumer(chatId: string): void {
  consumers.delete(chatId)
}

/** True when a non-expired agent consumer is attached to this chat. */
export function hasAgentConsumer(chatId: string): boolean {
  const expiresAt = consumers.get(chatId)
  if (expiresAt === undefined) return false
  if (expiresAt <= Date.now()) {
    consumers.delete(chatId)
    queues.delete(chatId)
    return false
  }
  return true
}

/**
 * Forward a user action to the agent attached to `chatId`.
 *
 * Returns the real delivery outcome. When no consumer is attached the action
 * is NOT queued and `delivered` is false — the caller is expected to surface
 * that to the user rather than report success.
 */
export function enqueueAgentAction(
  chatId: string,
  action: string,
  context: unknown
): DeliveryResult {
  if (!hasAgentConsumer(chatId)) {
    return { delivered: false, reason: 'no_agent_consumer' }
  }

  const message: A2UIQueuedMessage = {
    type: 'action',
    payload: { action, context: context ?? null },
    timestamp: Date.now(),
    messageId: newMessageId(),
  }

  const queue = queues.get(chatId) ?? []
  queue.push(message)
  while (queue.length > MAX_QUEUED_ACTIONS) {
    queue.shift()
  }
  queues.set(chatId, queue)

  return { delivered: true, actionId: message.messageId }
}

/**
 * Push an agent-originated message (render/update/state) onto the chat queue.
 * Unlike a user action this does not require a registered consumer — the
 * browser may still be attaching — so it always queues.
 */
export function enqueueAgentMessage(
  chatId: string,
  message: Partial<A2UIQueuedMessage> & { type: A2UIQueuedMessage['type'] }
): A2UIQueuedMessage {
  const full: A2UIQueuedMessage = {
    type: message.type,
    payload: message.payload ?? null,
    timestamp: message.timestamp ?? Date.now(),
    messageId: message.messageId ?? newMessageId(),
  }

  const queue = queues.get(chatId) ?? []
  queue.push(full)
  while (queue.length > MAX_QUEUED_ACTIONS) {
    queue.shift()
  }
  queues.set(chatId, queue)
  return full
}

/** Destructively drain everything queued for a chat. */
export function takePendingActions(chatId: string): A2UIQueuedMessage[] {
  const queue = queues.get(chatId)
  if (!queue || queue.length === 0) return []
  queues.set(chatId, [])
  return queue.splice(0)
}

/** Non-destructive depth check, for diagnostics. */
export function pendingActionCount(chatId: string): number {
  return queues.get(chatId)?.length ?? 0
}

/** Test-only: clear all queues and consumer registrations. */
export function __resetA2UIQueuesForTest(): void {
  queues.clear()
  consumers.clear()
}
