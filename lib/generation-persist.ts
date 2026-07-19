/**
 * Durable generation persistence orchestrator (builder#89).
 *
 * Blank-preview failures were caused by generations never landing in ZeroDB:
 *   1. saveGeneration was only called on the SUCCESS path (not degradation/error).
 *   2. It ran fire-and-forget AFTER the SSE stream started, so slow/cut requests
 *      aborted before it completed → /preview/<id> restore found nothing.
 *
 * This module provides a single persist call, usable on EVERY terminal path,
 * that awaits the save with a bounded timeout so it completes before `complete`
 * is sent without blocking the stream indefinitely. Pure w.r.t. its injected
 * save function so it's fully unit-testable.
 */

export interface PersistInput {
  chatId: string
  prompt: string
  /** The code being served to the user (valid code, checkpoint, or fallback). */
  code: string
  model: string
  /** Terminal outcome of the generation. */
  status: 'success' | 'degraded' | 'error'
  /** Whether the served code passed validation. */
  valid: boolean
}

export interface PersistResult {
  saved: boolean
  reason: 'saved' | 'skipped-empty' | 'timeout' | 'error'
}

/** A save function shaped like zerodb-store.saveGeneration. */
export type SaveFn = (data: {
  chatId: string
  prompt: string
  generatedCode: string
  model: string
  codeLength: number
  category?: string
  isShowcase?: boolean
}) => Promise<boolean>

/**
 * Persist a generation to ZeroDB, awaited but time-bounded. Returns a structured
 * result rather than throwing — persistence must never break the response.
 *
 * - Skips truly-empty code (nothing to restore).
 * - Bounds the await so a slow ZeroDB write can't hang the SSE stream.
 * - `isShowcase` only for valid, substantial code.
 */
export async function persistGeneration(
  input: PersistInput,
  save: SaveFn,
  opts: { timeoutMs?: number } = {},
): Promise<PersistResult> {
  const code = (input.code || '').trim()
  if (code.length === 0) {
    return { saved: false, reason: 'skipped-empty' }
  }

  const timeoutMs = opts.timeoutMs ?? 8_000
  const savePromise = save({
    chatId: input.chatId,
    prompt: input.prompt,
    generatedCode: input.code,
    model: input.model,
    codeLength: input.code.length,
    category: 'general',
    // Only surface valid, substantial builds to the showcase.
    isShowcase: input.status === 'success' && input.valid && input.code.length > 1500,
  }).then(
    (ok): PersistResult => ({ saved: ok, reason: ok ? 'saved' : 'error' }),
    (): PersistResult => ({ saved: false, reason: 'error' }),
  )

  const timeoutPromise = new Promise<PersistResult>((resolve) => {
    setTimeout(() => resolve({ saved: false, reason: 'timeout' }), timeoutMs)
  })

  return Promise.race([savePromise, timeoutPromise])
}
