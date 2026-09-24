/**
 * Shutdown-flush for in-flight generations (builder#865).
 *
 * Real, confirmed incident: a founder's (evan@ainative.studio, "flashpoint")
 * generation was still running when an ordinary main-branch deploy landed
 * (Railway restarts the process on every deploy). `lib/generation-persist.ts`'s
 * `persistGeneration()` — the module that guarantees a generation reaches
 * ZeroDB — is only ever called from chat-ws's own SUCCESS/DEGRADED/ERROR
 * terminal branches, near the very end of that request's handler. A process
 * kill mid-generation never reaches any of those branches, so nothing is
 * persisted at all: not a timeout, not a failed write (both already covered
 * by generation-persist.ts's own background-retry, builder#673) — a complete
 * non-invocation. Confirmed live: both the `generations` and `build_chat`
 * ZeroDB tables had zero rows for that chat, across three separate
 * provisioning attempts spanning the exact window a deploy landed in.
 *
 * This module is a process-wide registry of "generations currently in
 * flight and their best-so-far checkpoint," plus a `SIGTERM` handler that
 * flushes each one's last valid checkpoint via `persistGeneration` before
 * the process dies. Railway sends SIGTERM before killing on redeploy
 * (railway.toml's own healthcheck/restart comments already assume this), so
 * this converts "silently lost forever" into "recovers whatever the last
 * checkpointed stage was" — the same "worst case is a working earlier
 * version" guarantee `lib/generation-checkpoint.ts` already gives WITHIN a
 * single request, extended to survive the process itself dying.
 *
 * Deliberately NOT a full fix for every interruption (a hard OOM kill or a
 * crash gives no chance to run a shutdown handler at all) — see this
 * module's own doc + builder#865's suggested incremental-checkpoint
 * alternative for that. This is the SIGTERM case specifically, which covers
 * the actual incident (an ordinary deploy) and is a real, contained fix.
 */

import type { GenerationCheckpoint } from '@/lib/generation-checkpoint'
import { persistGeneration, type SaveFn } from '@/lib/generation-persist'

export interface InFlightGeneration {
  chatId: string
  prompt: string
  model: string
  checkpoint: GenerationCheckpoint
}

/** Process-wide: every generation currently running, keyed by chatId. */
const inFlight = new Map<string, InFlightGeneration>();

/** Register a generation as in-flight. Call as soon as chatId/prompt/model are known. */
export function registerInFlightGeneration(entry: InFlightGeneration): void {
  if (!entry.chatId) return
  inFlight.set(entry.chatId, entry)
}

/** Unregister once the request reaches ANY terminal branch (success/degraded/
 *  error all already persist via persistGeneration through their own path —
 *  this just stops the shutdown flush from redundantly re-persisting a
 *  generation that already completed normally). */
export function unregisterInFlightGeneration(chatId: string): void {
  inFlight.delete(chatId)
}

/** Test-only: current in-flight count, so tests can assert register/unregister
 *  actually mutated shared state without reaching into the module internals. */
export function inFlightCount(): number {
  return inFlight.size
}

/**
 * Flush every still-in-flight generation's best checkpoint. Pure w.r.t. its
 * injected save function + the entries passed in, so the actual decision
 * logic (what counts as flushable, what gets persisted) is fully unit-
 * testable without touching `process` or real ZeroDB. Returns the chatIds
 * actually flushed.
 */
export async function flushInFlightGenerations(
  entries: InFlightGeneration[],
  save: SaveFn,
): Promise<string[]> {
  const flushed: string[] = []
  await Promise.all(
    entries.map(async (entry) => {
      const cp = entry.checkpoint.get()
      if (!cp) return // nothing valid was ever checkpointed — no-op, not an error
      const result = await persistGeneration(
        {
          chatId: entry.chatId,
          prompt: entry.prompt,
          code: cp.code,
          model: entry.model,
          // A shutdown-flushed checkpoint is, by definition, an interrupted
          // generation — never a genuine success, and never eligible for the
          // showcase (that gate already requires status:'success').
          status: 'degraded',
          valid: true,
          skipShowcase: true,
        },
        save,
        { timeoutMs: 4_000 }, // shutdown windows are short — fail fast, rely on generation-persist's own background retry only if the process survives long enough
      )
      if (result.saved) flushed.push(entry.chatId)
    }),
  )
  return flushed
}

let shutdownHandlerInstalled = false

/**
 * Install the real `process.on('SIGTERM', ...)` handler exactly once. Safe to
 * call from module init on every request — a second call is a no-op, so this
 * can live at the top of chat-ws/route.ts without any separate app-bootstrap
 * wiring. No-op outside Node (e.g. edge runtime, or a test importing this
 * module without ever calling this function).
 */
export function installShutdownFlushHandler(save: SaveFn): void {
  if (shutdownHandlerInstalled) return
  if (typeof process === 'undefined' || typeof process.on !== 'function') return
  shutdownHandlerInstalled = true

  process.on('SIGTERM', () => {
    const entries = Array.from(inFlight.values())
    if (entries.length === 0) return
    console.warn(
      `[shutdown-flush] SIGTERM received with ${entries.length} generation(s) in flight — ` +
        `flushing best checkpoint for: ${entries.map((e) => e.chatId).join(', ')}`,
    )
    // Best-effort within whatever time the process has left before Railway
    // force-kills it — never throws, never blocks the shutdown itself.
    void flushInFlightGenerations(entries, save).then((flushed) => {
      console.warn(`[shutdown-flush] flushed ${flushed.length}/${entries.length} generation(s): ${flushed.join(', ')}`)
    })
  })
}
