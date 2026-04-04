/**
 * Retry utilities for API calls
 * Ported from cody-cli patterns (src/services/api/withRetry.ts)
 */

interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  retryOn?: (error: unknown) => boolean
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  retryOn: () => true,
}

function getRetryDelay(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  const delay = initialDelayMs * Math.pow(2, attempt)
  return Math.min(delay, maxDelayMs)
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Response) {
    const status = error.status
    return status === 429 || status === 502 || status === 503 || status === 504
  }
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    return status === 429 || status === 502 || status === 503 || status === 504
  }
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true // Network error
  }
  return false
}

function getRetryAfterMs(error: unknown): number | null {
  if (error instanceof Response) {
    const retryAfter = error.headers.get('Retry-After')
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10)
      if (!isNaN(seconds)) return seconds * 1000
    }
  }
  return null
}

/**
 * Generic retry wrapper with exponential backoff.
 * Handles 429, 5xx, and connection errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const isLastAttempt = attempt === opts.maxRetries
      const shouldRetry = opts.retryOn(error) || isRetryableError(error)

      if (isLastAttempt || !shouldRetry) {
        throw error
      }

      const retryAfter = getRetryAfterMs(error)
      const delay = retryAfter ?? getRetryDelay(attempt, opts.initialDelayMs, opts.maxDelayMs)

      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error('withRetry: unreachable')
}

/**
 * Wraps a function to catch 401 errors, refresh the token, and retry once.
 */
export async function withAuthRetry<T>(
  fn: () => Promise<T>,
  refreshFn: () => Promise<void>,
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const is401 =
      (error instanceof Response && error.status === 401) ||
      (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 401)

    if (!is401) throw error

    await refreshFn()
    return await fn()
  }
}
