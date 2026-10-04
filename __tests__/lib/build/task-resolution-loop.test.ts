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
}))

vi.mock('@/lib/build/task-store', () => ({ listTasks: h.listTasks }))
vi.mock('@/lib/build/task-resolver', () => ({ resolveTask: h.resolveTask }))

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
