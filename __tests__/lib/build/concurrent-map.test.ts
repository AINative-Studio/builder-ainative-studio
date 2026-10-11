import { describe, it, expect, vi } from 'vitest'
import { mapWithConcurrency } from '@/lib/build/concurrent-map'

/**
 * Bounded-concurrency map (#1055, Problem A).
 *
 * THE BUG: app/api/build/nightly-loop/route.ts iterated ~77 enrolled companies
 * with a plain serial `for (const e of enrolled)`, running the FULL per-company
 * pipeline (swarm dispatch + comms + daily report + media routine + backlog seed
 * + task resolution) one company at a time inside the route's own 300s
 * maxDuration — which the GitHub Action's identical `--max-time 300` client
 * timeout then raced. 9 of the last 15 scheduled runs died with
 * `curl: (28) Operation timed out after 300001ms`.
 *
 * This is the primitive the fix is built on: a real, CAPPED worker pool (never
 * unbounded — 77 simultaneous LLM/coverage pipelines would melt the process and
 * hammer core), with a deadline so the sweep stops cleanly instead of being
 * killed mid-company by the platform.
 */
describe('mapWithConcurrency (#1055)', () => {
  it('processes every item and preserves input order in the results', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7]
    const out = await mapWithConcurrency(items, 3, async (n) => n * 2)
    expect(out.map((r) => r.value)).toEqual([2, 4, 6, 8, 10, 12, 14])
    expect(out.every((r) => r.done)).toBe(true)
  })

  it('never runs more than `limit` workers at once — the real concurrency cap', async () => {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 50 }, (_, i) => i)
    await mapWithConcurrency(items, 6, async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active -= 1
      return null
    })
    expect(peak).toBeLessThanOrEqual(6)
    // and it genuinely DID parallelize — not accidentally serial
    expect(peak).toBeGreaterThan(1)
  })

  it('is genuinely faster than serial for the production-scale company count', async () => {
    const items = Array.from({ length: 77 }, (_, i) => i)
    const work = async () => {
      await new Promise((r) => setTimeout(r, 20))
      return null
    }
    const t0 = Date.now()
    await mapWithConcurrency(items, 8, work)
    const parallelMs = Date.now() - t0
    // Serial would be 77 * 20ms = ~1540ms. With a cap of 8 it must be well
    // under half that — the real wall-clock win this fix exists for.
    expect(parallelMs).toBeLessThan(700)
  })

  it('a rejecting worker never fails the whole sweep — other items still complete', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('company 2 blew up')
      return n
    })
    expect(out[0]).toMatchObject({ done: true, value: 1 })
    expect(out[1].done).toBe(true)
    expect(out[1].error).toBeInstanceOf(Error)
    expect(out[2]).toMatchObject({ done: true, value: 3 })
  })

  it('stops starting NEW work once the deadline has passed, and marks the rest not-done', async () => {
    const started: number[] = []
    const items = Array.from({ length: 20 }, (_, i) => i)
    const out = await mapWithConcurrency(
      items,
      2,
      async (n) => {
        started.push(n)
        await new Promise((r) => setTimeout(r, 10))
        return n
      },
      { deadline: Date.now() + 30 },
    )
    // It must have bailed early rather than grinding through all 20.
    expect(started.length).toBeLessThan(20)
    const skipped = out.filter((r) => !r.done)
    expect(skipped.length).toBeGreaterThan(0)
    // Skipped entries are honest: no value, no fabricated success.
    expect(skipped.every((r) => r.value === undefined)).toBe(true)
  })

  it('an already-passed deadline starts nothing at all', async () => {
    const work = vi.fn(async (n: number) => n)
    const out = await mapWithConcurrency([1, 2, 3], 4, work, { deadline: Date.now() - 1 })
    expect(work).not.toHaveBeenCalled()
    expect(out.every((r) => !r.done)).toBe(true)
  })

  it('handles an empty list and a limit below 1 without hanging', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
    const out = await mapWithConcurrency([1, 2], 0, async (n) => n)
    expect(out.map((r) => r.value)).toEqual([1, 2])
  })
})
