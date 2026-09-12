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
  /** Parsed multi-file map (#333) — persisted durably so multi-file apps can
   *  restore the Sandpack path after the live SSE stream is gone. */
  files?: Record<string, string>
  /**
   * Real bug found live (Meridian, 2026-09-10): the founder's chosen design
   * system was correctly stored in the in-memory preview store, but never
   * reached THIS durable ZeroDB path at all — so any request whose preview
   * fetch landed on a different Railway replica than the one that ran the
   * generation (in-memory state is per-process; confirmed via real
   * production multi-instance deployment) fell through to the ZeroDB
   * restore in app/api/preview/[id]/route.ts, which had nothing to restore
   * and silently served plain Inter/Poppins defaults regardless of what was
   * actually chosen. Threaded through here so a cross-replica restore stays
   * design-system-correct.
   */
  designSystemId?: string
  /**
   * Real gap fixed 2026-09-10: an explicit opt-out so verification/test
   * traffic (fired against the same real generation path as any founder's)
   * never enters the public showcase gallery, regardless of how good the
   * output looks. The showcase was flooded with dozens of internal test
   * generations because nothing distinguished them from real founder
   * traffic at persist time. Defaults to false (unset = normal, showcase-
   * eligible behavior) — never changes anything else about the generation.
   */
  skipShowcase?: boolean
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
  files?: Record<string, string>
  designSystemId?: string
}) => Promise<boolean>

/**
 * Persist a generation to ZeroDB, awaited but time-bounded. Returns a structured
 * result rather than throwing — persistence must never break the response.
 *
 * - Skips truly-empty code (nothing to restore).
 * - Bounds the await so a slow ZeroDB write can't hang the SSE stream.
 * - `isShowcase` only for valid, substantial code.
 *
 * Real bug found live (builder#673): when this raced past its own timeout
 * (or the underlying save genuinely failed), the generation's code was
 * simply never persisted — permanently. Nothing else in the codebase ever
 * retries this write. Confirmed live: a real, successful generation
 * (chili-crate-product) existed only in the in-memory preview store; the
 * durable `generations` table had zero rows for it, hours later.
 *
 * Fixed WITHOUT lengthening the awaited window (that directly extends how
 * long a founder waits mid-stream for 'complete'): on a timeout/error
 * outcome, kick off a detached, unawaited background retry with its own
 * longer budget (this container is a persistent Railway service, not
 * serverless, so it keeps running after this function — and the response —
 * returns; same pattern already proven for company-product's own
 * registration-durability fix, #660/#661). The caller's fast path is
 * unaffected either way; the background attempt is the actual fix for the
 * "permanently lost" failure mode, not an alternative to it.
 */
export async function persistGeneration(
  input: PersistInput,
  save: SaveFn,
  opts: { timeoutMs?: number; retryDelaysMs?: number[] } = {},
): Promise<PersistResult> {
  const code = (input.code || '').trim()
  if (code.length === 0) {
    return { saved: false, reason: 'skipped-empty' }
  }

  const timeoutMs = opts.timeoutMs ?? 8_000
  const saveArgs = {
    chatId: input.chatId,
    prompt: input.prompt,
    generatedCode: input.code,
    model: input.model,
    codeLength: input.code.length,
    category: 'general',
    // The multi-file map rides along when present (#333) — saveGeneration
    // enforces the row-size ceiling and drops it (logged) when oversized.
    files: input.files && Object.keys(input.files).length > 0 ? input.files : undefined,
    designSystemId: input.designSystemId,
    // Surface only successful, validated, substantial generations to the showcase.
    // The showcase quality gate (isQualityApp) also requires >= 2000 chars, so
    // flagging short code as isShowcase here is misleading — it would still be
    // filtered out. Aligning both thresholds keeps the intent consistent.
    // Degraded/errored builds are held back regardless of size. (builder#89/#58)
    isShowcase: !input.skipShowcase && input.status === 'success' && input.valid && input.code.length >= 2000,
  }

  const savePromise = save(saveArgs).then(
    (ok): PersistResult => ({ saved: ok, reason: ok ? 'saved' : 'error' }),
    (): PersistResult => ({ saved: false, reason: 'error' }),
  )

  const timeoutPromise = new Promise<PersistResult>((resolve) => {
    setTimeout(() => resolve({ saved: false, reason: 'timeout' }), timeoutMs)
  })

  const result = await Promise.race([savePromise, timeoutPromise])

  if (!result.saved) {
    // Best-effort background recovery — never awaited, never blocks the
    // caller. Bounded retry loop of its own (separate from saveGeneration's
    // internal zerodbRequest retry) so a genuinely down ZeroDB doesn't spin
    // forever; logs loudly on final failure since that's the last chance to
    // surface a truly, permanently lost generation.
    void backgroundPersistRetry(input.chatId, saveArgs, save, opts.retryDelaysMs ?? [5_000, 15_000, 30_000])
  }

  return result
}

async function backgroundPersistRetry(
  chatId: string,
  saveArgs: Parameters<SaveFn>[0],
  save: SaveFn,
  delaysMs: number[],
): Promise<void> {
  const attempts = delaysMs.length
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, delaysMs[i]))
    try {
      const ok = await save(saveArgs)
      if (ok) {
        console.log(`[PERSIST] background retry ${i + 1}/${attempts} succeeded for ${chatId} — generation recovered`)
        return
      }
      console.warn(`[PERSIST] background retry ${i + 1}/${attempts} failed for ${chatId}`)
    } catch (e) {
      console.warn(`[PERSIST] background retry ${i + 1}/${attempts} threw for ${chatId}:`, e)
    }
  }
  console.error(`[PERSIST] PERMANENT LOSS — generation ${chatId} was never durably persisted after the initial attempt + ${attempts} background retries. It exists only in the in-memory preview store (if that replica is still alive) and will be lost on restart/replica-switch.`)
}
