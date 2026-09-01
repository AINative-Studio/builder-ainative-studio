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

import { runTaskResolutions, MAX_TASKS_PER_COMPANY_PER_RUN } from '@/lib/build/task-resolution-loop'
import type { BuildTask } from '@/lib/build/task-store'

const task = (over: Partial<BuildTask> = {}): BuildTask => ({
  id: `t_${Math.random().toString(36).slice(2)}`,
  scopeKey: 'a::b',
  title: 'Do a thing',
  stage: 'todo',
  source: 'cody',
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

  it('caps at MAX_TASKS_PER_COMPANY_PER_RUN even with more todo tasks available', async () => {
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
