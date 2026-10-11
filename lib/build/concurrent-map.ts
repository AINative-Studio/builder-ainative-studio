/**
 * Bounded-concurrency map with a wall-clock deadline (#1055).
 *
 * WHY THIS EXISTS: app/api/build/nightly-loop/route.ts ran the full
 * per-company pipeline (swarm dispatch → comms outreach → daily report →
 * media routine → backlog seed → task resolution — every one of them a real
 * network/LLM call) for ~77 enrolled companies in a plain serial
 * `for (const e of enrolled)`, all inside the route's single 300s
 * `maxDuration`. The nightly GitHub Action POSTs with `--max-time 300` — the
 * SAME number — so the two raced each other and the client timed out first:
 * 9 of the last 15 scheduled runs died with
 * `curl: (28) Operation timed out after 300001 milliseconds with 0 bytes
 * received`, and the companies past wherever the sweep had got to never ran
 * at all.
 *
 * Two deliberate properties, both load-bearing:
 *
 *  1. A real, FINITE cap. Unbounded `Promise.all` over 77 companies would
 *     fire 77 concurrent LLM implementations + coverage runs (see
 *     task-resolution-loop.ts: coverage-runner's own timeout is 120s per
 *     task) at core and at this single Node process — trading a timeout for
 *     an OOM/rate-limit outage. A small worker pool gets nearly all of the
 *     wall-clock win with none of that.
 *
 *  2. A deadline, checked before each item STARTS. The pool stops admitting
 *     new work once the route's self-imposed budget is spent, so the route
 *     returns a real 200 with an honest "these N were deferred to the next
 *     tick" count instead of being killed mid-company by the platform at
 *     maxDuration (which loses the response entirely, and with it any record
 *     of what did run). Already-running items are allowed to finish — the
 *     budget is deliberately set well below maxDuration to leave room for
 *     exactly that.
 *
 * Kept generic + dependency-free (no p-limit) and in its own module so the
 * cap/deadline semantics the cron depends on are unit-testable without a
 * network. Pure control flow — no I/O of its own.
 */

/**
 * One slot's outcome. `done:false` means the item was never STARTED (the
 * deadline passed first) — it is honestly not-run, never a fabricated
 * success, so a caller can report it as deferred.
 */
export interface ConcurrentResult<R> {
  done: boolean
  value?: R
  error?: unknown
}

export interface ConcurrentMapOptions {
  /**
   * Epoch ms after which no NEW item is started. Items already in flight run
   * to completion. Omitted ⇒ no deadline.
   */
  deadline?: number
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once, stopping
 * admission at `options.deadline`. Results are returned in INPUT order
 * (never completion order) so a caller can line them up with their inputs.
 *
 * Never rejects: a worker that throws is captured as `{ done: true, error }`
 * for that item and the sweep continues — one company's blow-up must never
 * take down the rest of the nightly run.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options: ConcurrentMapOptions = {},
): Promise<ConcurrentResult<R>[]> {
  const results: ConcurrentResult<R>[] = items.map(() => ({ done: false }))
  if (items.length === 0) return results

  // A nonsensical limit (0, negative, NaN) must degrade to "run them, one at
  // a time" rather than hanging forever with no workers.
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))

  let next = 0
  const expired = () => options.deadline !== undefined && Date.now() >= options.deadline

  async function drain(): Promise<void> {
    for (;;) {
      if (expired()) return
      const index = next++
      if (index >= items.length) return
      try {
        results[index] = { done: true, value: await worker(items[index], index) }
      } catch (error) {
        results[index] = { done: true, error }
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => drain()))
  return results
}

/**
 * Split a list into `count` interleaved shards and return shard `index`.
 *
 * Used by the nightly loop so the GitHub Action can split one 77-company
 * sweep into several smaller, independently-timed HTTP calls instead of one
 * call that must fit everything inside a single 300s budget.
 *
 * Interleaved (`i % count === index`) rather than contiguous slices on
 * purpose: the enrollment list's order is whatever the append-only ZeroDB
 * table returns, so a contiguous slice would bind a company to a shard by
 * accident of row order and let a list-length change silently re-home it.
 * Modulo over a STABLE index gives every shard a comparable mix and — the
 * property that actually matters — guarantees every company is covered by
 * exactly one shard, with no overlaps and no gaps.
 *
 * A malformed/out-of-range shard spec degrades to the WHOLE list: processing
 * every company is the safe failure mode for a nightly cron; processing none
 * would silently skip a night for everyone. Pure.
 */
export function selectShard<T>(items: readonly T[], index: unknown, count: unknown): T[] {
  const shards = Number(count)
  const shard = Number(index)
  const valid =
    Number.isInteger(shards) && shards > 1 &&
    Number.isInteger(shard) && shard >= 0 && shard < shards
  if (!valid) return [...items]
  return items.filter((_, i) => i % shards === shard)
}
