/**
 * Circuit breaker for external-dependency calls (issue #1191).
 *
 * Problem this solves: several external dependencies (the design-tokens
 * MCP server, ZeroDB, template-matching, model APIs) fail by hanging or
 * timing out rather than failing fast. Without a breaker, every request
 * during an outage pays the full retry/timeout cost again and again, and
 * the UI either blocks or silently renders degraded defaults with no
 * indication anything is wrong.
 *
 * This app runs single-process-per-replica (no shared distributed state
 * requirement — see CLAUDE.md), so an in-memory failure counter + last-
 * failure timestamp per dependency key is the right-sized implementation.
 * No external store, no cross-instance coordination.
 *
 * State machine:
 *   closed     — calls go through; consecutive failures are counted
 *   open       — calls short-circuit immediately (no real call attempted)
 *                until `cooldownMs` has elapsed since the breaker opened
 *   half-open  — the cooldown has elapsed; exactly one trial call is let
 *                through. Success -> closed. Failure -> open again for a
 *                fresh cooldown window.
 */

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  /** Consecutive failures required to open the breaker. Default 3. */
  failureThreshold?: number
  /** How long the breaker stays open before allowing a trial call, in ms. Default 30s. */
  cooldownMs?: number
}

export interface CircuitBreakerResult<T> {
  success: boolean
  value?: T
  error?: unknown
  /** True when the call never actually ran because the breaker was open. */
  shortCircuited: boolean
}

const DEFAULT_FAILURE_THRESHOLD = 3
const DEFAULT_COOLDOWN_MS = 30_000

export class CircuitBreaker {
  private readonly key: string
  private readonly failureThreshold: number
  private readonly cooldownMs: number

  private consecutiveFailures = 0
  private state: CircuitState = 'closed'
  private openedAt: number | null = null

  constructor(key: string, options: CircuitBreakerOptions = {}) {
    this.key = key
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
  }

  getKey(): string {
    return this.key
  }

  /**
   * Current state, resolving an elapsed cooldown into 'half-open' as a
   * side effect of being asked (the breaker has no background timer).
   */
  getState(): CircuitState {
    this.maybeExpireCooldown()
    return this.state
  }

  /** True if a call right now would short-circuit without running. */
  isOpen(): boolean {
    return this.getState() === 'open'
  }

  /**
   * Run `fn` through the breaker. Never throws — failures are reported in
   * the returned result so callers can decide how to degrade gracefully.
   */
  async execute<T>(fn: () => Promise<T>): Promise<CircuitBreakerResult<T>> {
    const state = this.getState()

    if (state === 'open') {
      return { success: false, shortCircuited: true, error: new Error(`circuit breaker open for dependency "${this.key}"`) }
    }

    try {
      const value = await fn()
      this.onSuccess()
      return { success: true, value, shortCircuited: false }
    } catch (error) {
      this.onFailure()
      return { success: false, error, shortCircuited: false }
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0
    this.state = 'closed'
    this.openedAt = null
  }

  private onFailure(): void {
    this.consecutiveFailures += 1

    if (this.state === 'half-open' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open'
      this.openedAt = Date.now()
    }
  }

  private maybeExpireCooldown(): void {
    if (this.state === 'open' && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt
      if (elapsed >= this.cooldownMs) {
        this.state = 'half-open'
      }
    }
  }
}

const registry = new Map<string, CircuitBreaker>()

/**
 * Get (or lazily create) the shared breaker instance for a dependency key.
 * Options only apply on first creation for a given key within the
 * process's lifetime — subsequent calls just return the existing instance.
 */
export function getCircuitBreaker(key: string, options?: CircuitBreakerOptions): CircuitBreaker {
  let breaker = registry.get(key)
  if (!breaker) {
    breaker = new CircuitBreaker(key, options)
    registry.set(key, breaker)
  }
  return breaker
}

/** Test-only helper: clears all registered breaker state between tests. */
export function resetAllCircuitBreakers(): void {
  registry.clear()
}
