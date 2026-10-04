import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TASK_STAGES,
  STAGE_LABELS,
  normalizeStage,
  stageFromSwarmStatus,
  isTaskStage,
  filterByStage,
  countByStage,
  coerceTask,
  sortTasks,
  recurringTaskFromLoop,
  withRecurringTask,
  taskScopeKey,
  createTask,
  listTasks,
  updateTask,
  MAX_LOAD_TASKS,
  type BuildTask,
} from '@/lib/build/task-store'

/**
 * #55 — Tasks/Backlog store. Covers the pure core (stage normalization, swarm
 * status → stage, filtering/counting, coercion, sort, recurring synthesis, scope
 * key) and the ZeroDB-backed I/O (create/list/update) by mocking global.fetch.
 * The vitest env is 'node'; fetch is stubbed per-test so no network is touched —
 * same strategy as the chat-store tests.
 */

const mkTask = (over: Partial<BuildTask> = {}): BuildTask => ({
  id: over.id || 't1',
  scopeKey: over.scopeKey || 'a::b',
  title: over.title || 'Task',
  detail: over.detail,
  stage: over.stage || 'todo',
  source: over.source || 'cody',
  taskId: over.taskId ?? null,
  output: over.output,
  storyPoints: over.storyPoints ?? null,
  estimateRationale: over.estimateRationale ?? null,
  createdAt: over.createdAt || '2026-01-01T00:00:00Z',
  updatedAt: over.updatedAt || over.createdAt || '2026-01-01T00:00:00Z',
})

// ---------- stage constants ----------
describe('TASK_STAGES + STAGE_LABELS (#55)', () => {
  it('has exactly the six Toby-specified stages', () => {
    expect([...TASK_STAGES]).toEqual(['todo', 'recurring', 'in_progress', 'completed', 'rejected', 'failed'])
  })
  it('has a human label for every stage', () => {
    for (const s of TASK_STAGES) expect(typeof STAGE_LABELS[s]).toBe('string')
    expect(STAGE_LABELS.in_progress).toBe('In Progress')
    expect(STAGE_LABELS.todo).toBe('To Do')
  })
})

// ---------- normalizeStage ----------
describe('normalizeStage (#55)', () => {
  it('passes through the six canonical stages', () => {
    for (const s of TASK_STAGES) expect(normalizeStage(s)).toBe(s)
  })
  it('maps loose aliases to canonical stages', () => {
    expect(normalizeStage('running')).toBe('in_progress')
    expect(normalizeStage('active')).toBe('in_progress')
    expect(normalizeStage('dispatched')).toBe('in_progress')
    expect(normalizeStage('done')).toBe('completed')
    expect(normalizeStage('success')).toBe('completed')
    expect(normalizeStage('error')).toBe('failed')
    expect(normalizeStage('cancelled')).toBe('failed')
    expect(normalizeStage('declined')).toBe('rejected')
    expect(normalizeStage('scheduled')).toBe('recurring')
    expect(normalizeStage('queued')).toBe('todo')
  })
  it('normalizes whitespace/dashes/case ("In-Progress" → in_progress)', () => {
    expect(normalizeStage('In-Progress')).toBe('in_progress')
    expect(normalizeStage('  COMPLETED ')).toBe('completed')
  })
  it('falls back to todo for unknown/empty', () => {
    expect(normalizeStage('nonsense')).toBe('todo')
    expect(normalizeStage('')).toBe('todo')
    expect(normalizeStage(null)).toBe('todo')
    expect(normalizeStage(undefined)).toBe('todo')
  })
})

// ---------- stageFromSwarmStatus ----------
describe('stageFromSwarmStatus (#55)', () => {
  it('maps completion statuses to completed', () => {
    expect(stageFromSwarmStatus('completed')).toBe('completed')
    expect(stageFromSwarmStatus('done')).toBe('completed')
    expect(stageFromSwarmStatus('succeeded')).toBe('completed')
  })
  it('maps failure statuses to failed', () => {
    expect(stageFromSwarmStatus('failed')).toBe('failed')
    expect(stageFromSwarmStatus('error')).toBe('failed')
    expect(stageFromSwarmStatus('cancelled')).toBe('failed')
  })
  it('maps reject statuses to rejected', () => {
    expect(stageFromSwarmStatus('rejected')).toBe('rejected')
    expect(stageFromSwarmStatus('declined')).toBe('rejected')
  })
  it('maps dispatched/queued/running to in_progress', () => {
    expect(stageFromSwarmStatus('dispatched')).toBe('in_progress')
    expect(stageFromSwarmStatus('queued')).toBe('in_progress')
    expect(stageFromSwarmStatus('running')).toBe('in_progress')
  })
  it('defaults to in_progress for empty (a dispatch just happened)', () => {
    expect(stageFromSwarmStatus('')).toBe('in_progress')
    expect(stageFromSwarmStatus(null)).toBe('in_progress')
  })
})

// ---------- isTaskStage ----------
describe('isTaskStage (#55)', () => {
  it('accepts real stages, rejects everything else', () => {
    expect(isTaskStage('todo')).toBe(true)
    expect(isTaskStage('completed')).toBe(true)
    expect(isTaskStage('all')).toBe(false)
    expect(isTaskStage('bogus')).toBe(false)
    expect(isTaskStage(undefined)).toBe(false)
  })
})

// ---------- filterByStage ----------
describe('filterByStage (#55)', () => {
  const tasks = [mkTask({ id: '1', stage: 'todo' }), mkTask({ id: '2', stage: 'completed' }), mkTask({ id: '3', stage: 'todo' })]
  it('returns all for falsy/all', () => {
    expect(filterByStage(tasks, undefined)).toHaveLength(3)
    expect(filterByStage(tasks, 'all')).toHaveLength(3)
    expect(filterByStage(tasks, null)).toHaveLength(3)
  })
  it('filters to a single stage', () => {
    expect(filterByStage(tasks, 'todo').map((t) => t.id)).toEqual(['1', '3'])
    expect(filterByStage(tasks, 'completed').map((t) => t.id)).toEqual(['2'])
  })
  it('returns [] for an unknown stage', () => {
    expect(filterByStage(tasks, 'bogus')).toEqual([])
  })
  it('handles a non-array defensively', () => {
    expect(filterByStage(undefined as any, 'todo')).toEqual([])
  })
})

// ---------- countByStage ----------
describe('countByStage (#55)', () => {
  it('returns a full record with every stage present (0 when empty)', () => {
    const c = countByStage([])
    for (const s of TASK_STAGES) expect(c[s]).toBe(0)
  })
  it('counts tasks per stage', () => {
    const c = countByStage([mkTask({ stage: 'todo' }), mkTask({ stage: 'todo' }), mkTask({ stage: 'failed' })])
    expect(c.todo).toBe(2)
    expect(c.failed).toBe(1)
    expect(c.completed).toBe(0)
  })
  it('ignores tasks with a bad stage', () => {
    const c = countByStage([{ ...mkTask(), stage: 'bogus' as any }])
    for (const s of TASK_STAGES) expect(c[s]).toBe(0)
  })
})

// ---------- coerceTask ----------
describe('coerceTask (#55)', () => {
  it('coerces a row_data-wrapped row and normalizes stage/source', () => {
    const t = coerceTask({ row_data: { id: 'x', title: 'Do it', stage: 'running', source: 'swarm', task_id: 'p1', created_at: '2026-01-01' } })
    expect(t).toMatchObject({ id: 'x', title: 'Do it', stage: 'in_progress', source: 'swarm', taskId: 'p1' })
  })
  it('coerces a persisted gitea_issue_number into giteaIssueNumber (#905)', () => {
    const t = coerceTask({ row_data: { id: 'x', title: 'Do it', gitea_issue_number: 42 } })
    expect(t?.giteaIssueNumber).toBe(42)
  })
  it('defaults giteaIssueNumber to null when absent (#905)', () => {
    const t = coerceTask({ title: 'Do it' })
    expect(t?.giteaIssueNumber).toBeNull()
  })
  it('also accepts a camelCase giteaIssueNumber on the raw row (#905)', () => {
    const t = coerceTask({ title: 'Do it', giteaIssueNumber: 9 })
    expect(t?.giteaIssueNumber).toBe(9)
  })
  it('accepts a flat row (no row_data wrapper)', () => {
    const t = coerceTask({ title: 'Flat', stage: 'todo' }, 'a::b')
    expect(t?.title).toBe('Flat')
    expect(t?.scopeKey).toBe('a::b')
  })
  it('defaults an unknown source to cody', () => {
    expect(coerceTask({ title: 'x', source: 'martian' })?.source).toBe('cody')
  })
  it('returns null when there is no usable title', () => {
    expect(coerceTask({ title: '   ' })).toBeNull()
    expect(coerceTask(null)).toBeNull()
    expect(coerceTask({})).toBeNull()
  })
  it('defaults updatedAt to createdAt when absent', () => {
    const t = coerceTask({ title: 'x', created_at: '2026-02-02' })
    expect(t?.updatedAt).toBe('2026-02-02')
  })

  // #902: storyPoints / estimateRationale coercion
  it('coerces a valid story_points + estimate_rationale pair through', () => {
    const t = coerceTask({ title: 'x', story_points: 3, estimate_rationale: 'One clear feature slice.' })
    expect(t?.storyPoints).toBe(3)
    expect(t?.estimateRationale).toBe('One clear feature slice.')
  })
  it('accepts the camelCase alias (storyPoints/estimateRationale)', () => {
    const t = coerceTask({ title: 'x', storyPoints: 5, estimateRationale: 'Multi-file.' })
    expect(t?.storyPoints).toBe(5)
    expect(t?.estimateRationale).toBe('Multi-file.')
  })
  it('coerces a missing story_points (pre-#902 row) to null/null', () => {
    const t = coerceTask({ title: 'x' })
    expect(t?.storyPoints).toBeNull()
    expect(t?.estimateRationale).toBeNull()
  })
  it('coerces a non-Fibonacci story_points (corrupt data) to null, dropping the rationale too', () => {
    const t = coerceTask({ title: 'x', story_points: 4, estimate_rationale: 'should be dropped' })
    expect(t?.storyPoints).toBeNull()
    expect(t?.estimateRationale).toBeNull()
  })
  it('treats storyPoints: 0 as a real estimate, not falsy/absent', () => {
    const t = coerceTask({ title: 'x', story_points: 0, estimate_rationale: 'Trivial.' })
    expect(t?.storyPoints).toBe(0)
    expect(t?.estimateRationale).toBe('Trivial.')
  })
  it('truncates an oversized rationale to 300 chars', () => {
    const t = coerceTask({ title: 'x', story_points: 2, estimate_rationale: 'y'.repeat(1000) })
    expect(t?.estimateRationale?.length).toBe(300)
  })
})

// ---------- sortTasks ----------
describe('sortTasks (#55)', () => {
  it('sorts newest-updated first, non-mutating', () => {
    const input = [
      mkTask({ id: 'a', updatedAt: '2026-01-01T00:00:01Z' }),
      mkTask({ id: 'b', updatedAt: '2026-01-01T00:00:03Z' }),
      mkTask({ id: 'c', updatedAt: '2026-01-01T00:00:02Z' }),
    ]
    const out = sortTasks(input)
    expect(out.map((t) => t.id)).toEqual(['b', 'c', 'a'])
    expect(input.map((t) => t.id)).toEqual(['a', 'b', 'c']) // original untouched
  })
  it('falls back to createdAt when updatedAt is absent', () => {
    const out = sortTasks([
      { ...mkTask({ id: 'a' }), updatedAt: '', createdAt: '2026-01-01T00:00:01Z' },
      { ...mkTask({ id: 'b' }), updatedAt: '', createdAt: '2026-01-01T00:00:05Z' },
    ])
    expect(out.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

// ---------- recurringTaskFromLoop ----------
describe('recurringTaskFromLoop (#55)', () => {
  it('returns null when not enrolled', () => {
    expect(recurringTaskFromLoop('a::b', false, null)).toBeNull()
  })
  it('returns null for a blank scope key', () => {
    expect(recurringTaskFromLoop('', true, null)).toBeNull()
  })
  it('synthesizes a recurring task when enrolled with no run yet', () => {
    const t = recurringTaskFromLoop('a::b', true, null)
    expect(t).toMatchObject({ id: 'recurring:nightly-loop', stage: 'recurring', source: 'recurring' })
    expect(t?.detail).toContain('scheduled tonight')
    expect(t?.output).toBeUndefined()
  })
  it('reflects a real last run (taskId + status + output)', () => {
    const t = recurringTaskFromLoop('a::b', true, { lastTaskId: 'p9', lastStatus: 'dispatched', lastRunAt: '2026-08-24T02:00:00Z' })
    expect(t?.taskId).toBe('p9')
    expect(t?.detail).toContain('2026-08-24T02:00:00Z')
    expect(t?.output).toContain('p9')
  })
})

// ---------- withRecurringTask ----------
describe('withRecurringTask (#55)', () => {
  it('prepends the recurring task when present', () => {
    const out = withRecurringTask([mkTask({ id: 'x' })], recurringTaskFromLoop('a::b', true, null))
    expect(out[0].id).toBe('recurring:nightly-loop')
    expect(out.map((t) => t.id)).toContain('x')
  })
  it('de-dups any stale persisted recurring row so it never doubles', () => {
    const stale = mkTask({ id: 'recurring:nightly-loop', stage: 'recurring' })
    const out = withRecurringTask([stale, mkTask({ id: 'y' })], recurringTaskFromLoop('a::b', true, null))
    expect(out.filter((t) => t.id === 'recurring:nightly-loop')).toHaveLength(1)
  })
  it('drops any stale recurring row when there is no live recurring task', () => {
    const stale = mkTask({ id: 'recurring:nightly-loop' })
    const out = withRecurringTask([stale, mkTask({ id: 'z' })], null)
    expect(out.map((t) => t.id)).toEqual(['z'])
  })
})

// ---------- taskScopeKey ----------
describe('taskScopeKey (#55)', () => {
  it('keys by owner email + lowercased slug (same as chat scope)', () => {
    expect(taskScopeKey({ user: { email: 'Founder@Acme.com', type: 'regular' } }, 'Acme-Co')).toBe('founder@acme.com::acme-co')
  })
  it('keys a guest by their session id', () => {
    expect(taskScopeKey({ user: { email: 'guest-a@example.com', type: 'guest', id: 'u1' } }, 'x')).toBe('guest:u1::x')
  })
})

// ---------- I/O: createTask / listTasks / updateTask ----------
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

/**
 * createTask also fires a best-effort estimation call (#902) to AINative's
 * chat/completions proxy — a DIFFERENT endpoint than the ZeroDB rows/query
 * calls the rest of this suite mocks. This dispatcher-based fetch mock lets a
 * single stub answer both: ZeroDB urls get `zerodb`'s response, anything
 * hitting `/chat/completions` gets `estimate`'s. Defaulting `estimate` to a
 * benign fixed reply keeps every pre-existing createTask test (written before
 * #902) valid unchanged — they never asserted on story_points/rationale, and
 * still don't need to.
 */
type FetchStub = { ok: boolean; status?: number; json?: () => any }

function mockCreateFlow(opts: {
  zerodb: (url: string, init?: any) => FetchStub
  estimate?: (url: string, init?: any) => FetchStub
}) {
  const estimate: (url: string, init?: any) => FetchStub =
    opts.estimate ||
    (() => ({ ok: true, json: () => ({ choices: [{ message: { content: 'POINTS: 2\nRATIONALE: Small, well-defined.' } }] }) }))
  const fn = vi.fn(async (url: string, init?: any) => {
    const u = String(url)
    const r = u.includes('/chat/completions') ? estimate(u, init) : opts.zerodb(u, init)
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

describe('createTask (#55, #902)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('POSTs a row and returns the coerced task on success', async () => {
    const fn = mockCreateFlow({ zerodb: () => ({ ok: true, json: () => ({ id: 'r1' }) }) })
    const t = await createTask('a::b', { title: 'Ship it', stage: 'dispatched', source: 'swarm', taskId: 'p1' })
    expect(t).toMatchObject({ title: 'Ship it', stage: 'in_progress', source: 'swarm', taskId: 'p1', scopeKey: 'a::b' })
    const rowsCall = fn.mock.calls.find((c) => String(c[0]).includes('/database/tables/build_tasks/rows'))!
    const [url, init] = rowsCall
    expect(url).toContain('/database/tables/build_tasks/rows')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.row_data).toMatchObject({ scope_key: 'a::b', title: 'Ship it', stage: 'in_progress', source: 'swarm' })
    expect(typeof body.row_data.created_at).toBe('string')
  })

  it('rejects a blank scope or blank title without calling fetch', async () => {
    const fn = mockCreateFlow({ zerodb: () => ({ ok: true }) })
    expect(await createTask('', { title: 'x' })).toBeNull()
    expect(await createTask('a::b', { title: '   ' })).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('defaults source to cody and stage to todo', async () => {
    mockCreateFlow({ zerodb: () => ({ ok: true, json: () => ({}) }) })
    const t = await createTask('a::b', { title: 'x' })
    expect(t?.source).toBe('cody')
    expect(t?.stage).toBe('todo')
  })

  it('persists giteaIssueNumber when provided at creation (#905)', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ id: 'r1' }) }))
    const t = await createTask('a::b', { title: 'x', giteaIssueNumber: 42 })
    expect(t?.giteaIssueNumber).toBe(42)
    const body = JSON.parse(fn.mock.calls[0][1].body)
    expect(body.row_data.gitea_issue_number).toBe(42)
  })

  it('defaults giteaIssueNumber to null when not provided (#905)', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ id: 'r1' }) }))
    const t = await createTask('a::b', { title: 'x' })
    expect(t?.giteaIssueNumber).toBeNull()
    const body = JSON.parse(fn.mock.calls[0][1].body)
    expect(body.row_data.gitea_issue_number).toBeNull()
  })

  it('returns null (never throws) on a non-ok response', async () => {
    mockCreateFlow({ zerodb: () => ({ ok: false, status: 500 }) })
    expect(await createTask('a::b', { title: 'x' })).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await createTask('a::b', { title: 'x' })).toBeNull()
  })

  // ---------- #902: Fibonacci estimation wiring ----------
  it('persists the estimated storyPoints + rationale on the created row and returned task', async () => {
    const fn = mockCreateFlow({
      zerodb: () => ({ ok: true, json: () => ({ id: 'r1' }) }),
      estimate: () => ({ ok: true, json: () => ({ choices: [{ message: { content: 'POINTS: 5\nRATIONALE: Touches several files.' } }] }) }),
    })
    const t = await createTask('a::b', { title: 'Rework the billing flow' })
    expect(t?.storyPoints).toBe(5)
    expect(t?.estimateRationale).toBe('Touches several files.')
    const rowsCall = fn.mock.calls.find((c) => String(c[0]).includes('/database/tables/build_tasks/rows'))!
    const body = JSON.parse(rowsCall[1].body)
    expect(body.row_data.story_points).toBe(5)
    expect(body.row_data.estimate_rationale).toBe('Touches several files.')
  })

  it('a trivial task (typo-level) title estimates to 0 or 1', async () => {
    mockCreateFlow({
      zerodb: () => ({ ok: true, json: () => ({ id: 'r1' }) }),
      estimate: () => ({ ok: true, json: () => ({ choices: [{ message: { content: 'POINTS: 0\nRATIONALE: Single-character typo fix.' } }] }) }),
    })
    const t = await createTask('a::b', { title: 'Fix typo in footer copy' })
    expect([0, 1]).toContain(t?.storyPoints)
  })

  it('a complex multi-part task title estimates to 5 or 8', async () => {
    mockCreateFlow({
      zerodb: () => ({ ok: true, json: () => ({ id: 'r1' }) }),
      estimate: () => ({ ok: true, json: () => ({ choices: [{ message: { content: 'POINTS: 8\nRATIONALE: Rewrites auth and migrates schema across six files.' } }] }) }),
    })
    const t = await createTask('a::b', {
      title: 'Rewrite the entire authentication system and migrate the database schema',
      detail: 'New auth provider, data migration, SSO, admin UI, audit log, rollback plan.',
    })
    expect([5, 8]).toContain(t?.storyPoints)
  })

  it('still creates the task with storyPoints/estimateRationale null when the estimation call fails (never blocks creation)', async () => {
    const fn = mockCreateFlow({
      zerodb: () => ({ ok: true, json: () => ({ id: 'r1' }) }),
      estimate: () => ({ ok: false, status: 500 }),
    })
    const t = await createTask('a::b', { title: 'Anything' })
    expect(t).not.toBeNull()
    expect(t?.storyPoints).toBeNull()
    expect(t?.estimateRationale).toBeNull()
    const rowsCall = fn.mock.calls.find((c) => String(c[0]).includes('/database/tables/build_tasks/rows'))!
    const body = JSON.parse(rowsCall[1].body)
    expect(body.row_data.story_points).toBeNull()
    expect(body.row_data.estimate_rationale).toBeNull()
  })

  it('still creates the task when the estimation call throws/times out (never blocks creation)', async () => {
    const fn = vi.fn(async (url: string, init?: any) => {
      const u = String(url)
      if (u.includes('/chat/completions')) throw new Error('timeout')
      return { ok: true, status: 200, json: async () => ({ id: 'r1' }), text: async () => '' } as any
    })
    vi.stubGlobal('fetch', fn)
    const t = await createTask('a::b', { title: 'Anything' })
    expect(t).not.toBeNull()
    expect(t?.storyPoints).toBeNull()
  })
})

describe('listTasks (#55)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns [] for a blank scope key without calling fetch', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    expect(await listTasks('')).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('queries by scope_key and returns tasks newest-updated first', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      json: () => ({
        data: [
          { row_data: { id: 'a', title: 'older', stage: 'todo', updated_at: '2026-01-01T00:00:01Z' } },
          { row_data: { id: 'b', title: 'newer', stage: 'completed', updated_at: '2026-01-01T00:00:05Z' } },
        ],
      }),
    }))
    const tasks = await listTasks('a::b')
    expect(tasks.map((t) => t.id)).toEqual(['b', 'a'])
    const [url, init] = fn.mock.calls[0]
    expect(url).toContain('/database/tables/build_tasks/query')
    expect(JSON.parse(init.body).filters).toEqual({ scope_key: 'a::b' })
  })

  it('drops malformed rows (no title)', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ data: [{ row_data: { id: 'x', title: '' } }, { row_data: { id: 'y', title: 'keep' } }] }) }))
    const tasks = await listTasks('a::b')
    expect(tasks.map((t) => t.id)).toEqual(['y'])
  })

  it('clamps an oversized limit to MAX_LOAD_TASKS in the query', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ data: [] }) }))
    await listTasks('a::b', MAX_LOAD_TASKS + 999)
    expect(JSON.parse(fn.mock.calls[0][1].body).limit).toBe(MAX_LOAD_TASKS)
  })

  it('returns [] on empty data', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ data: [] }) }))
    expect(await listTasks('a::b')).toEqual([])
  })

  it('returns [] (never throws) when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    expect(await listTasks('a::b')).toEqual([])
  })

  it('retries once on a transient 500 then succeeds', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n += 1
      if (n === 1) return { ok: false, status: 500, json: async () => ({}), text: async () => '' } as any
      return { ok: true, status: 200, json: async () => ({ data: [{ row_data: { id: 'a', title: 'ok' } }] }), text: async () => '' } as any
    })
    vi.stubGlobal('fetch', fn)
    const tasks = await listTasks('a::b')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(tasks.map((t) => t.id)).toEqual(['a'])
  })
})

describe('updateTask (#55)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  /**
   * Real bug found live (#698 follow-up): the real ZeroDB rows API does not
   * support a bulk PUT .../rows filtered by {scope_key, id} together — only
   * scope_key alone matches; adding id to the SAME filter object returns 0
   * rows even for a task confirmed to exist with that exact pair (confirmed
   * directly against production). updateTask now queries by scope_key alone
   * (the same call shape listTasks already uses, confirmed working), finds
   * the matching row by id in application code, then PUTs the full merged
   * row_data to the real per-row endpoint .../rows/{row_id}.
   */
  function mockUpdateFlow(opts: {
    existingRow?: { row_id: string; row_data: Record<string, unknown> } | null
    putOk?: boolean
  }) {
    const fn = vi.fn(async (url: string, init?: any) => {
      const u = String(url)
      if (u.endsWith('/query') && init?.method === 'POST') {
        const data = opts.existingRow ? [opts.existingRow] : []
        return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' } as any
      }
      if (/\/rows\/[^/]+$/.test(u) && init?.method === 'PUT') {
        return { ok: opts.putOk !== false, status: opts.putOk !== false ? 200 : 500, json: async () => ({ ok: true }), text: async () => '' } as any
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any
    })
    vi.stubGlobal('fetch', fn)
    return fn
  }

  it('queries by scope_key, finds the row by id, then PUTs to the real per-row endpoint', async () => {
    const fn = mockUpdateFlow({
      existingRow: { row_id: 'row-abc', row_data: { id: 't1', stage: 'todo', scope_key: 'a::b', title: 'x' } },
    })
    const ok = await updateTask('a::b', 't1', { stage: 'completed' })
    expect(ok).toBe(true)

    const queryCall = fn.mock.calls.find((c) => String(c[0]).endsWith('/query'))!
    const queryBody = JSON.parse(queryCall[1].body)
    expect(queryBody.filters).toEqual({ scope_key: 'a::b' })

    const putCall = fn.mock.calls.find((c) => /\/rows\/row-abc$/.test(String(c[0])))!
    expect(putCall[1].method).toBe('PUT')
    const putBody = JSON.parse(putCall[1].body)
    expect(putBody.row_data.stage).toBe('completed')
    expect(putBody.row_data.title).toBe('x') // unrelated fields preserved via merge
    expect(typeof putBody.row_data.updated_at).toBe('string')
  })

  it('normalizes a loose stage on update', async () => {
    const fn = mockUpdateFlow({
      existingRow: { row_id: 'row-abc', row_data: { id: 't1', stage: 'todo', scope_key: 'a::b' } },
    })
    await updateTask('a::b', 't1', { stage: 'running' })
    const putCall = fn.mock.calls.find((c) => /\/rows\/row-abc$/.test(String(c[0])))!
    expect(JSON.parse(putCall[1].body).row_data.stage).toBe('in_progress')
  })

  it('rejects a blank scope or id without calling fetch', async () => {
    const fn = mockUpdateFlow({ existingRow: null })
    expect(await updateTask('', 't1', { stage: 'todo' })).toBe(false)
    expect(await updateTask('a::b', '', { stage: 'todo' })).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('is a no-op success when the patch has nothing to change', async () => {
    const fn = mockUpdateFlow({ existingRow: null })
    expect(await updateTask('a::b', 't1', {})).toBe(true)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when no row matches the given id within the scope', async () => {
    mockUpdateFlow({ existingRow: null })
    expect(await updateTask('a::b', 't1', { stage: 'failed' })).toBe(false)
  })

  it('returns false (never throws) when the PUT itself fails', async () => {
    mockUpdateFlow({
      existingRow: { row_id: 'row-abc', row_data: { id: 't1', stage: 'todo', scope_key: 'a::b' } },
      putOk: false,
    })
    expect(await updateTask('a::b', 't1', { stage: 'failed' })).toBe(false)
  })

  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await updateTask('a::b', 't1', { output: 'x' })).toBe(false)
  })

  it('persists giteaIssueNumber on a patch (#905)', async () => {
    const fn = mockUpdateFlow({
      existingRow: { row_id: 'row-abc', row_data: { id: 't1', stage: 'todo', scope_key: 'a::b' } },
    })
    const ok = await updateTask('a::b', 't1', { giteaIssueNumber: 42 })
    expect(ok).toBe(true)
    const putCall = fn.mock.calls.find((c) => /\/rows\/row-abc$/.test(String(c[0])))!
    expect(JSON.parse(putCall[1].body).row_data.gitea_issue_number).toBe(42)
  })

  it('treats a giteaIssueNumber-only patch as a real change, not a no-op (#905)', async () => {
    const fn = mockUpdateFlow({
      existingRow: { row_id: 'row-abc', row_data: { id: 't1', stage: 'todo', scope_key: 'a::b' } },
    })
    await updateTask('a::b', 't1', { giteaIssueNumber: 7 })
    expect(fn).toHaveBeenCalled()
  })
})
