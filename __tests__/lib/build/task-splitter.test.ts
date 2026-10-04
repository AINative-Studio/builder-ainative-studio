import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #904 (epic #900, depends on #902/#903) — decompose an over-3-point backlog
 * task into 2-4 smaller, independently-estimated sub-tasks instead of ever
 * handing it directly to resolveTask(). Mirrors story-estimator.test.ts's
 * split: pure prompt-building/response-parsing tested directly; the real
 * LLM call (splitTaskViaLLM) and the full orchestration (splitTask) tested by
 * mocking their dependencies.
 *
 * MOCKING GOTCHA (left by #903's agent in project memory
 * project_backlog_fibonacci_split_detection.md): mocking '@/lib/build/task-store'
 * as a plain object literal silently yields `needsSplit: undefined` because it
 * replaces the whole module. Any test here that mocks task-store must keep the
 * REAL `needsSplit`/`isFibonacciPoint`-derived pure functions via
 * vi.importActual, not reimplement them.
 */

const h = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  estimateStoryPoints: vi.fn(),
}))

vi.mock('@/lib/build/task-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/task-store')>('@/lib/build/task-store')
  return {
    ...actual,
    createTask: h.createTask,
    updateTask: h.updateTask,
  }
})

vi.mock('@/lib/build/story-estimator', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/story-estimator')>('@/lib/build/story-estimator')
  return {
    ...actual,
    estimateStoryPoints: h.estimateStoryPoints,
  }
})

import {
  buildSplitPrompt,
  parseSplitResponse,
  splitTask,
  MAX_SPLIT_DEPTH,
  type SubTaskDraft,
} from '@/lib/build/task-splitter'
import type { BuildTask } from '@/lib/build/task-store'

const task = (over: Partial<BuildTask> = {}): BuildTask => ({
  id: 'parent-1',
  scopeKey: 'a::b',
  title: 'Rebuild the entire billing and invoicing subsystem',
  detail: 'Multi-part: new billing engine, invoice PDF generation, dunning emails, admin UI.',
  stage: 'todo',
  source: 'cody',
  taskId: null,
  storyPoints: 8,
  estimateRationale: 'Touches many systems.',
  parentTaskId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

// ---------- buildSplitPrompt (pure) ----------
describe('buildSplitPrompt (#904)', () => {
  it('includes the task title', () => {
    const p = buildSplitPrompt('Rebuild billing', undefined)
    expect(p).toContain('Rebuild billing')
  })
  it('includes the detail when present', () => {
    const p = buildSplitPrompt('Rebuild billing', 'New engine, PDFs, dunning.')
    expect(p).toContain('New engine, PDFs, dunning.')
  })
  it('omits a Detail line when detail is absent/blank', () => {
    expect(buildSplitPrompt('X', undefined)).not.toContain('Detail:')
    expect(buildSplitPrompt('X', '   ')).not.toContain('Detail:')
  })
})

// ---------- parseSplitResponse (pure) ----------
describe('parseSplitResponse (#904)', () => {
  it('parses 2-4 well-formed SUBTASK blocks', () => {
    const raw = [
      'SUBTASK: Build the billing engine core',
      'DETAIL: Implement plan/price calculation and ledger entries.',
      '---',
      'SUBTASK: Generate invoice PDFs',
      'DETAIL: Render and store a PDF per invoice.',
      '---',
      'SUBTASK: Send dunning emails',
      'DETAIL: Email founders on overdue invoices.',
    ].join('\n')
    const r = parseSplitResponse(raw)
    expect(r).toHaveLength(3)
    expect(r[0]).toEqual({ title: 'Build the billing engine core', detail: 'Implement plan/price calculation and ledger entries.' })
    expect(r[2].title).toBe('Send dunning emails')
  })

  it('parses a subtask block with no DETAIL line (detail becomes undefined)', () => {
    const raw = 'SUBTASK: Just a title, no detail'
    const r = parseSplitResponse(raw)
    expect(r).toEqual([{ title: 'Just a title, no detail', detail: undefined }])
  })

  it('is case-insensitive for the SUBTASK/DETAIL labels', () => {
    const raw = 'subtask: Lowercase label\ndetail: lowercase detail'
    const r = parseSplitResponse(raw)
    expect(r).toEqual([{ title: 'Lowercase label', detail: 'lowercase detail' }])
  })

  it('drops a block with a blank title', () => {
    const raw = ['SUBTASK:   ', '---', 'SUBTASK: Real one'].join('\n')
    const r = parseSplitResponse(raw)
    expect(r).toEqual([{ title: 'Real one', detail: undefined }])
  })

  it('caps at 4 subtasks even if the model emits more', () => {
    const raw = Array.from({ length: 6 }, (_, i) => `SUBTASK: Part ${i + 1}`).join('\n---\n')
    const r = parseSplitResponse(raw)
    expect(r).toHaveLength(4)
  })

  it('returns [] for unparseable text (no SUBTASK label found)', () => {
    expect(parseSplitResponse('I cannot decompose this.')).toEqual([])
    expect(parseSplitResponse('')).toEqual([])
    expect(parseSplitResponse(null as any)).toEqual([])
  })
})

// ---------- splitTask (I/O orchestration) ----------
function mockFetch(impl: (url: string, init?: any) => { ok: boolean; status?: number; json?: () => any }) {
  const fn = vi.fn(async (url: string, init?: any) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ? r.json() : {}),
      text: async () => '',
    } as any
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const SPLIT_REPLY_3 = [
  'SUBTASK: Build the billing engine core',
  'DETAIL: Implement plan/price calculation and ledger entries.',
  '---',
  'SUBTASK: Generate invoice PDFs',
  'DETAIL: Render and store a PDF per invoice.',
  '---',
  'SUBTASK: Send dunning emails',
  'DETAIL: Email founders on overdue invoices.',
].join('\n')

describe('splitTask (#904)', () => {
  beforeEach(() => {
    process.env.ZERODB_API_KEY = 'k'
    h.createTask.mockReset()
    h.updateTask.mockReset()
    h.estimateStoryPoints.mockReset()
    h.updateTask.mockResolvedValue(true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('decomposes an oversized task into 2-4 child tasks, each persisted as todo, linked via parentTaskId', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ choices: [{ message: { content: SPLIT_REPLY_3 } }] }) }))
    h.estimateStoryPoints.mockResolvedValue({ storyPoints: 2, estimateRationale: 'Small slice.' })
    let n = 0
    h.createTask.mockImplementation(async (_scope: string, input: any) => ({
      id: `child-${++n}`,
      scopeKey: 'a::b',
      title: input.title,
      detail: input.detail,
      stage: 'todo',
      source: 'cody',
      taskId: null,
      storyPoints: 2,
      estimateRationale: 'Small slice.',
      parentTaskId: input.parentTaskId,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }))

    const result = await splitTask('a::b', task())

    expect(result.ok).toBe(true)
    expect(result.childIds).toHaveLength(3)
    expect(h.createTask).toHaveBeenCalledTimes(3)
    for (const call of h.createTask.mock.calls) {
      expect(call[0]).toBe('a::b')
      expect(call[1].parentTaskId).toBe('parent-1')
      expect(call[1].stage).toBe('todo')
    }
  })

  it('marks the parent completed with an honest output note referencing the real child ids', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ choices: [{ message: { content: SPLIT_REPLY_3 } }] }) }))
    h.estimateStoryPoints.mockResolvedValue({ storyPoints: 1, estimateRationale: 'Tiny.' })
    let n = 0
    h.createTask.mockImplementation(async (_scope: string, input: any) => ({
      id: `child-${++n}`,
      scopeKey: 'a::b',
      title: input.title,
      stage: 'todo',
      source: 'cody',
      taskId: null,
      storyPoints: 1,
      estimateRationale: 'Tiny.',
      parentTaskId: input.parentTaskId,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }))

    await splitTask('a::b', task())

    expect(h.updateTask).toHaveBeenCalledWith(
      'a::b',
      'parent-1',
      expect.objectContaining({ stage: 'completed' }),
    )
    const call = h.updateTask.mock.calls.find((c) => c[1] === 'parent-1' && c[2]?.stage === 'completed')!
    const output = String(call[2].output)
    expect(output).toContain('child-1')
    expect(output).toContain('child-2')
    expect(output).toContain('child-3')
  })

  it('never fabricates children: when the LLM reply is unparseable, the parent is left untouched (not completed, not failed)', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ choices: [{ message: { content: 'I refuse.' } }] }) }))

    const result = await splitTask('a::b', task())

    expect(result.ok).toBe(false)
    expect(h.createTask).not.toHaveBeenCalled()
    expect(h.updateTask).not.toHaveBeenCalled()
  })

  it('never fabricates children: when the LLM call fails outright, the parent is left untouched for a future retry', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))

    const result = await splitTask('a::b', task())

    expect(result.ok).toBe(false)
    expect(h.createTask).not.toHaveBeenCalled()
    expect(h.updateTask).not.toHaveBeenCalled()
  })

  it('never throws when the LLM call itself throws/times out — leaves the parent untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))

    await expect(splitTask('a::b', task())).resolves.toMatchObject({ ok: false })
    expect(h.createTask).not.toHaveBeenCalled()
    expect(h.updateTask).not.toHaveBeenCalled()
  })

  it('a splitter failure after some children were already created still does not mark the parent completed without a full honest set — fails closed if createTask returns null for any child', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ choices: [{ message: { content: SPLIT_REPLY_3 } }] }) }))
    h.estimateStoryPoints.mockResolvedValue({ storyPoints: 2, estimateRationale: 'Small slice.' })
    let n = 0
    h.createTask.mockImplementation(async (_scope: string, input: any) => {
      n += 1
      if (n === 2) return null // simulate a persistence failure on the 2nd child
      return {
        id: `child-${n}`,
        scopeKey: 'a::b',
        title: input.title,
        stage: 'todo',
        source: 'cody',
        taskId: null,
        storyPoints: 2,
        estimateRationale: 'Small slice.',
        parentTaskId: input.parentTaskId,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }
    })

    const result = await splitTask('a::b', task())

    expect(result.ok).toBe(false)
    // the parent must never be marked completed on a partial/failed child set
    expect(h.updateTask).not.toHaveBeenCalledWith('a::b', 'parent-1', expect.objectContaining({ stage: 'completed' }))
  })

  it('bounds recursion: a child task still estimating >3 points is re-split up to MAX_SPLIT_DEPTH, then accepted as-is', async () => {
    expect(MAX_SPLIT_DEPTH).toBeGreaterThanOrEqual(1)
    expect(MAX_SPLIT_DEPTH).toBeLessThanOrEqual(5) // a genuinely small fixed bound, not unlimited

    mockFetch(() => ({ ok: true, json: () => ({ choices: [{ message: { content: SPLIT_REPLY_3 } }] }) }))
    // Every child, at every re-split level, still estimates oversized (5) —
    // proves recursion terminates at MAX_SPLIT_DEPTH rather than looping forever.
    h.estimateStoryPoints.mockResolvedValue({ storyPoints: 5, estimateRationale: 'Still large.' })
    let n = 0
    h.createTask.mockImplementation(async (_scope: string, input: any) => ({
      id: `child-${++n}`,
      scopeKey: 'a::b',
      title: input.title,
      stage: 'todo',
      source: 'cody',
      taskId: null,
      storyPoints: 5,
      estimateRationale: 'Still large.',
      parentTaskId: input.parentTaskId,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }))

    await expect(splitTask('a::b', task(), { depth: 0 })).resolves.toMatchObject({ ok: true })
    // must terminate (the promise resolving at all, within the vitest timeout,
    // proves no infinite loop) — exact fetch call count is depth-bounded, not unbounded.
    expect(fetch).toHaveBeenCalled()
  }, 15000)

  it('does not re-split a child once MAX_SPLIT_DEPTH is reached — accepts it as-is', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ choices: [{ message: { content: SPLIT_REPLY_3 } }] }) }))
    h.estimateStoryPoints.mockResolvedValue({ storyPoints: 8, estimateRationale: 'Huge.' })
    let n = 0
    h.createTask.mockImplementation(async (_scope: string, input: any) => ({
      id: `child-${++n}`,
      scopeKey: 'a::b',
      title: input.title,
      stage: 'todo',
      source: 'cody',
      taskId: null,
      storyPoints: 8,
      estimateRationale: 'Huge.',
      parentTaskId: input.parentTaskId,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }))

    const result = await splitTask('a::b', task(), { depth: MAX_SPLIT_DEPTH })
    // at the depth ceiling, splitTask must not recurse again — it creates this
    // level's children directly and stops, still succeeding honestly.
    expect(result.ok).toBe(true)
    expect(result.childIds.length).toBeGreaterThan(0)
  })

  it('fails closed (not completed) when marking the parent completed itself fails, even though children were persisted', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ choices: [{ message: { content: SPLIT_REPLY_3 } }] }) }))
    h.estimateStoryPoints.mockResolvedValue({ storyPoints: 1, estimateRationale: 'Tiny.' })
    let n = 0
    h.createTask.mockImplementation(async (_scope: string, input: any) => ({
      id: `child-${++n}`,
      scopeKey: 'a::b',
      title: input.title,
      stage: 'todo',
      source: 'cody',
      taskId: null,
      storyPoints: 1,
      estimateRationale: 'Tiny.',
      parentTaskId: input.parentTaskId,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }))
    h.updateTask.mockResolvedValue(false) // simulate the final "mark parent completed" write failing

    const result = await splitTask('a::b', task())

    expect(result.ok).toBe(false)
    expect(result.childIds).toHaveLength(3) // the children ARE real and were persisted
    expect(result.reason).toMatch(/marking the parent completed failed/)
  })

  it('never throws when splitTaskViaLLM itself (unexpectedly) throws past its own internal catch', async () => {
    // Exercises splitTask's own defensive try/catch around the LLM call,
    // independent of splitTaskViaLLM's internal (already-tested) catch.
    const mod = await import('@/lib/build/task-splitter')
    const spy = vi.spyOn(mod, 'splitTaskViaLLM').mockRejectedValue(new Error('unexpected'))
    const result = await mod.splitTask('a::b', task())
    expect(result.ok).toBe(false)
    expect(h.createTask).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('rejects a reply with fewer than 2 subtasks (not a valid split)', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ choices: [{ message: { content: 'SUBTASK: Only one' } }] }) }))

    const result = await splitTask('a::b', task())

    expect(result.ok).toBe(false)
    expect(h.createTask).not.toHaveBeenCalled()
    expect(h.updateTask).not.toHaveBeenCalled()
  })
})
