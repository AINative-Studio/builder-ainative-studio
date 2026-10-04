import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #433 (epic #371) — the nightly-loop hook that gives resolveTask() its first
 * real caller. Mocks listTasks + resolveTask at the module boundary (same
 * pattern as task-resolver-io.test.ts) so this orchestration logic is proven
 * independent of the real ZeroDB/Gitea/LLM/coverage I/O those already cover.
 */

const h = vi.hoisted(() => ({
  listTasks: vi.fn(),
  resolveTask: vi.fn(),
  splitTask: vi.fn(),
}))

// needsSplit (#903) is a real, pure, no-I/O derivation — keep the real
// implementation in this mock (rather than stubbing it) so these tests prove
// actual behavior, not a re-description of a fake.
vi.mock('@/lib/build/task-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/task-store')>('@/lib/build/task-store')
  return { listTasks: h.listTasks, needsSplit: actual.needsSplit }
})
vi.mock('@/lib/build/task-resolver', () => ({ resolveTask: h.resolveTask }))
vi.mock('@/lib/build/task-splitter', () => ({ splitTask: h.splitTask }))

import {
  runTaskResolutions,
  MAX_TASKS_PER_COMPANY_PER_RUN,
  maxTasksForTier,
  TASK_LIMIT_BY_TIER,
  FREE_TIER_TASK_LIMIT,
} from '@/lib/build/task-resolution-loop'
import type { BuildTask } from '@/lib/build/task-store'

const task = (over: Partial<BuildTask> = {}): BuildTask => ({
  id: `t_${Math.random().toString(36).slice(2)}`,
  scopeKey: 'a::b',
  title: 'Do a thing',
  stage: 'todo',
  source: 'cody',
  // #902: unestimated by default in this fixture — these orchestration tests
  // don't exercise sizing, same as any pre-#902 row.
  storyPoints: null,
  estimateRationale: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

beforeEach(() => {
  h.listTasks.mockReset()
  h.resolveTask.mockReset()
  h.splitTask.mockReset()
  h.splitTask.mockResolvedValue({ ok: true, childIds: ['c1', 'c2'] })
})

describe('runTaskResolutions (#433)', () => {
  it('returns 0/0 with no scope or slug', async () => {
    expect(await runTaskResolutions('', 'slug')).toEqual({ attempted: 0, completed: 0 })
    expect(await runTaskResolutions('a::b', '')).toEqual({ attempted: 0, completed: 0 })
    expect(h.listTasks).not.toHaveBeenCalled()
  })

  it('resolves a due todo task and reports it completed on success', async () => {
    h.listTasks.mockResolvedValue([task()])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res).toEqual({ attempted: 1, completed: 1 })
    expect(h.resolveTask).toHaveBeenCalledWith('a::b', expect.objectContaining({ stage: 'todo' }), 'my-co')
  })

  it('counts an attempted-but-failed resolution honestly (not completed)', async () => {
    h.listTasks.mockResolvedValue([task()])
    h.resolveTask.mockResolvedValue({ ok: false, stage: 'failed', reason: 'coverage below floor' })
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res).toEqual({ attempted: 1, completed: 0 })
  })

  it('skips tasks that are not in the todo stage', async () => {
    h.listTasks.mockResolvedValue([
      task({ stage: 'in_progress' }),
      task({ stage: 'completed' }),
      task({ stage: 'failed' }),
      task({ stage: 'rejected' }),
    ])
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res).toEqual({ attempted: 0, completed: 0 })
    expect(h.resolveTask).not.toHaveBeenCalled()
  })

  it('caps at MAX_TASKS_PER_COMPANY_PER_RUN (free-tier default) even with more todo tasks available, when no plan tier is given', async () => {
    expect(MAX_TASKS_PER_COMPANY_PER_RUN).toBe(1)
    h.listTasks.mockResolvedValue([task({ id: 't1' }), task({ id: 't2' }), task({ id: 't3' })])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res.attempted).toBe(MAX_TASKS_PER_COMPANY_PER_RUN)
    expect(h.resolveTask).toHaveBeenCalledTimes(MAX_TASKS_PER_COMPANY_PER_RUN)
  })

  it('resolves the OLDEST due task first (FIFO)', async () => {
    h.listTasks.mockResolvedValue([
      task({ id: 'newer', createdAt: '2026-06-01T00:00:00.000Z' }),
      task({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z' }),
    ])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    await runTaskResolutions('a::b', 'my-co')
    expect(h.resolveTask).toHaveBeenCalledWith('a::b', expect.objectContaining({ id: 'older' }), 'my-co')
  })

  it('never throws when listing tasks fails', async () => {
    h.listTasks.mockRejectedValue(new Error('zerodb down'))
    await expect(runTaskResolutions('a::b', 'my-co')).resolves.toEqual({ attempted: 0, completed: 0 })
  })

  it('never throws when resolveTask itself throws — continues to the next task', async () => {
    h.listTasks.mockResolvedValue([task({ id: 't1' })])
    h.resolveTask.mockRejectedValue(new Error('llm call exploded'))
    await expect(runTaskResolutions('a::b', 'my-co')).resolves.toEqual({ attempted: 1, completed: 0 })
  })

  it('returns 0/0 when there are no tasks at all', async () => {
    h.listTasks.mockResolvedValue([])
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res).toEqual({ attempted: 0, completed: 0 })
  })
})

/**
 * #903 (epic #900, depends on #902): a `todo` task estimated at 3/5/8 story
 * points is oversized per `.ainative/RULES.MD` §2 and must be SPLIT (#904)
 * before it's implemented directly — this loop must never hand one to
 * resolveTask() while it's still oversized.
 */
describe('runTaskResolutions skips oversized (needsSplit) tasks (#903)', () => {
  it('never calls resolveTask for a todo task estimated at 3, 5, or 8', async () => {
    h.listTasks.mockResolvedValue([
      task({ id: 't3', storyPoints: 3 }),
      task({ id: 't5', storyPoints: 5 }),
      task({ id: 't8', storyPoints: 8 }),
    ])
    const res = await runTaskResolutions('a::b', 'my-co', 'enterprise')
    expect(res).toEqual({ attempted: 0, completed: 0 })
    expect(h.resolveTask).not.toHaveBeenCalled()
  })

  it('still resolves a todo task estimated at 0, 1, or 2 (not oversized)', async () => {
    h.listTasks.mockResolvedValue([task({ id: 't1', storyPoints: 1 })])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res).toEqual({ attempted: 1, completed: 1 })
    expect(h.resolveTask).toHaveBeenCalledWith('a::b', expect.objectContaining({ id: 't1' }), 'my-co')
  })

  it('still resolves an unestimated (null storyPoints) todo task — never blocks on a missing estimate', async () => {
    h.listTasks.mockResolvedValue([task({ id: 'tn', storyPoints: null })])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res).toEqual({ attempted: 1, completed: 1 })
  })

  it('skips an oversized task but still resolves a smaller due task in the same run, under the tier limit', async () => {
    h.listTasks.mockResolvedValue([
      task({ id: 'big', storyPoints: 8, createdAt: '2026-01-01T00:00:00.000Z' }),
      task({ id: 'small', storyPoints: 2, createdAt: '2026-01-02T00:00:00.000Z' }),
    ])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res).toEqual({ attempted: 1, completed: 1 })
    expect(h.resolveTask).toHaveBeenCalledWith('a::b', expect.objectContaining({ id: 'small' }), 'my-co')
  })

  it('an oversized task never counts against the per-run tier limit (a paid tier still gets real throughput)', async () => {
    h.listTasks.mockResolvedValue([
      task({ id: 'big1', storyPoints: 5, createdAt: '2026-01-01T00:00:00.000Z' }),
      task({ id: 'ok1', storyPoints: 1, createdAt: '2026-01-02T00:00:00.000Z' }),
      task({ id: 'ok2', storyPoints: 2, createdAt: '2026-01-03T00:00:00.000Z' }),
    ])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co', 'starter')
    expect(res.attempted).toBe(2)
    expect(h.resolveTask).not.toHaveBeenCalledWith('a::b', expect.objectContaining({ id: 'big1' }), 'my-co')
  })
})

/**
 * #904 (epic #900, depends on #902/#903) — instead of just filtering
 * oversized (`needsSplit`) todo tasks out forever, runTaskResolutions() now
 * calls splitTask() on each one (best-effort) before resolving the rest of
 * the due list.
 */
describe('runTaskResolutions calls splitTask on oversized (needsSplit) tasks (#904)', () => {
  it('calls splitTask for every todo task estimated at 3, 5, or 8', async () => {
    h.listTasks.mockResolvedValue([
      task({ id: 't3', storyPoints: 3 }),
      task({ id: 't5', storyPoints: 5 }),
      task({ id: 't8', storyPoints: 8 }),
    ])
    await runTaskResolutions('a::b', 'my-co')
    expect(h.splitTask).toHaveBeenCalledTimes(3)
    expect(h.splitTask).toHaveBeenCalledWith('a::b', expect.objectContaining({ id: 't3' }))
    expect(h.splitTask).toHaveBeenCalledWith('a::b', expect.objectContaining({ id: 't5' }))
    expect(h.splitTask).toHaveBeenCalledWith('a::b', expect.objectContaining({ id: 't8' }))
  })

  it('never calls splitTask for a non-oversized or unestimated todo task', async () => {
    h.listTasks.mockResolvedValue([task({ id: 'small', storyPoints: 2 }), task({ id: 'ne', storyPoints: null })])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    await runTaskResolutions('a::b', 'my-co')
    expect(h.splitTask).not.toHaveBeenCalled()
  })

  it('still resolves the normal due tasks in the same run after splitting the oversized ones', async () => {
    h.listTasks.mockResolvedValue([
      task({ id: 'big', storyPoints: 8, createdAt: '2026-01-01T00:00:00.000Z' }),
      task({ id: 'small', storyPoints: 2, createdAt: '2026-01-02T00:00:00.000Z' }),
    ])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(h.splitTask).toHaveBeenCalledWith('a::b', expect.objectContaining({ id: 'big' }))
    expect(h.resolveTask).toHaveBeenCalledWith('a::b', expect.objectContaining({ id: 'small' }), 'my-co')
    expect(res).toEqual({ attempted: 1, completed: 1 })
  })

  it('never calls resolveTask directly on an oversized task, even after splitTask runs', async () => {
    h.listTasks.mockResolvedValue([task({ id: 'big', storyPoints: 5 })])
    await runTaskResolutions('a::b', 'my-co')
    expect(h.resolveTask).not.toHaveBeenCalled()
  })

  it('a splitTask failure (ok: false) does not throw and does not count against attempted/completed', async () => {
    h.listTasks.mockResolvedValue([task({ id: 'big', storyPoints: 8 })])
    h.splitTask.mockResolvedValue({ ok: false, childIds: [], reason: 'LLM call failed' })
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res).toEqual({ attempted: 0, completed: 0 })
  })

  it('never throws when splitTask itself throws — continues the run (other due tasks still resolve)', async () => {
    h.listTasks.mockResolvedValue([
      task({ id: 'big', storyPoints: 8, createdAt: '2026-01-01T00:00:00.000Z' }),
      task({ id: 'small', storyPoints: 1, createdAt: '2026-01-02T00:00:00.000Z' }),
    ])
    h.splitTask.mockRejectedValue(new Error('splitter exploded'))
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    await expect(runTaskResolutions('a::b', 'my-co')).resolves.toEqual({ attempted: 1, completed: 1 })
  })

  it('an oversized task sent to splitTask still never counts against the per-run tier limit', async () => {
    h.listTasks.mockResolvedValue([
      task({ id: 'big1', storyPoints: 5, createdAt: '2026-01-01T00:00:00.000Z' }),
      task({ id: 'ok1', storyPoints: 1, createdAt: '2026-01-02T00:00:00.000Z' }),
      task({ id: 'ok2', storyPoints: 2, createdAt: '2026-01-03T00:00:00.000Z' }),
    ])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co', 'starter')
    expect(res.attempted).toBe(2)
  })
})

/**
 * #908 (epic #900) — plan-tier-aware nightly backlog throughput.
 * MAX_TASKS_PER_COMPANY_PER_RUN was a flat constant applied identically to
 * every plan tier. maxTasksForTier() + TASK_LIMIT_BY_TIER replace it with a
 * real per-tier ceiling, and runTaskResolutions() takes an optional resolved
 * plan tier to pick the right ceiling instead of always using 1.
 */
describe('maxTasksForTier (#908)', () => {
  it('free/hobbyist gets the conservative default — must not regress below today\'s effective value (1)', () => {
    expect(maxTasksForTier('hobbyist')).toBe(FREE_TIER_TASK_LIMIT)
    expect(FREE_TIER_TASK_LIMIT).toBe(1)
  })

  it('starter gets a higher limit than free', () => {
    expect(maxTasksForTier('starter')).toBeGreaterThan(maxTasksForTier('hobbyist'))
  })

  it('pro and business get a higher limit than starter', () => {
    expect(maxTasksForTier('pro')).toBeGreaterThan(maxTasksForTier('starter'))
    expect(maxTasksForTier('business')).toBeGreaterThan(maxTasksForTier('starter'))
  })

  it('enterprise and cody_vcto get the highest ceiling', () => {
    expect(maxTasksForTier('enterprise')).toBeGreaterThanOrEqual(maxTasksForTier('business'))
    expect(maxTasksForTier('cody_vcto')).toBeGreaterThanOrEqual(maxTasksForTier('business'))
  })

  it('every configured tier is a finite, sane ceiling — never literally unlimited (cost control)', () => {
    for (const tier of Object.keys(TASK_LIMIT_BY_TIER)) {
      const limit = maxTasksForTier(tier)
      expect(Number.isFinite(limit)).toBe(true)
      expect(limit).toBeGreaterThan(0)
      expect(limit).toBeLessThanOrEqual(50) // sane ceiling, not Infinity
    }
  })

  it('an unknown/garbage tier string degrades to the free-tier limit (never over-grant)', () => {
    expect(maxTasksForTier('totally-made-up-tier')).toBe(FREE_TIER_TASK_LIMIT)
    expect(maxTasksForTier('')).toBe(FREE_TIER_TASK_LIMIT)
  })

  it('null/undefined (plan-resolution failure) degrades to the free-tier limit — never unlimited', () => {
    expect(maxTasksForTier(null)).toBe(FREE_TIER_TASK_LIMIT)
    expect(maxTasksForTier(undefined)).toBe(FREE_TIER_TASK_LIMIT)
  })

  it('is case-insensitive (tier strings from core are not guaranteed lowercase)', () => {
    expect(maxTasksForTier('ENTERPRISE')).toBe(maxTasksForTier('enterprise'))
    expect(maxTasksForTier('Pro')).toBe(maxTasksForTier('pro'))
  })

  it('accepts the launch/company aliases normalizeTier() folds into pro/business', () => {
    expect(maxTasksForTier('launch')).toBe(maxTasksForTier('pro'))
    expect(maxTasksForTier('company')).toBe(maxTasksForTier('business'))
  })
})

describe('runTaskResolutions with a resolved plan tier (#908)', () => {
  it('a free-tier company is capped at the free-tier limit', async () => {
    h.listTasks.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => task({ id: `t${i}` })),
    )
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co', 'hobbyist')
    expect(res.attempted).toBe(FREE_TIER_TASK_LIMIT)
  })

  it('a paid-tier company gets its tier\'s (higher) limit', async () => {
    h.listTasks.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => task({ id: `t${i}` })),
    )
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co', 'enterprise')
    expect(res.attempted).toBeGreaterThan(FREE_TIER_TASK_LIMIT)
    expect(res.attempted).toBe(maxTasksForTier('enterprise'))
  })

  it('a plan-resolution failure (empty string / unresolved) degrades to the free-tier limit, never unlimited', async () => {
    h.listTasks.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => task({ id: `t${i}` })),
    )
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co', '')
    expect(res.attempted).toBe(FREE_TIER_TASK_LIMIT)
  })

  it('omitting the plan tier entirely (backward compat) still defaults to the free-tier limit', async () => {
    h.listTasks.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => task({ id: `t${i}` })),
    )
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    const res = await runTaskResolutions('a::b', 'my-co')
    expect(res.attempted).toBe(FREE_TIER_TASK_LIMIT)
  })

  it('still resolves the OLDEST due tasks first (FIFO) under a higher tier limit', async () => {
    h.listTasks.mockResolvedValue([
      task({ id: 'newest', createdAt: '2026-06-01T00:00:00.000Z' }),
      task({ id: 'oldest', createdAt: '2026-01-01T00:00:00.000Z' }),
      task({ id: 'middle', createdAt: '2026-03-01T00:00:00.000Z' }),
    ])
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })
    await runTaskResolutions('a::b', 'my-co', 'starter')
    const resolvedIds = h.resolveTask.mock.calls.map((c) => c[1].id)
    expect(resolvedIds[0]).toBe('oldest')
  })
})
