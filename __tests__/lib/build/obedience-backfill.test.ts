import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1954 — one-shot backlog backfill for obedience-gate gaps already live in
 * production.
 *
 * THE BUG: `checkObedience()` only ever runs against a company's code at the
 * moment a chat session is generating/re-prompting it (#1140 wires its final
 * result into a createTask() call). Nothing re-checks a company's CURRENT
 * code outside that moment, so a gap that predates #1140 — or that a company
 * simply hasn't had a new chat turn since — sits live and untracked
 * indefinitely. Confirmed live for `wrench` and `beacon` (#1954).
 *
 * The invariants these tests protect:
 *  - A company with no obedience gap is left alone (no task filed).
 *  - A company with a real gap gets a task filed with the exact same
 *    title/detail shape #1140's chat-ws createTask() call uses, so the
 *    existing Gitea resolver pipeline treats it identically either way.
 *  - A company that already has a non-terminal task for the same gap is
 *    never double-filed (idempotent re-run).
 *  - A company with no chatId, or whose durable code can't be loaded, is
 *    reported honestly rather than crashing or being silently skipped as
 *    "clean".
 *  - A failed registry read is never reported as "every company is clean"
 *    (core#7395's exact failure mode).
 *  - Dry run is the default: an accidental call files no tasks.
 *  - A soft-deleted company is never re-checked or re-filed against.
 */

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

interface FakeApp {
  slug: string
  chatId?: string
  ownerEmail?: string
  idea?: string
  lifecycleStatus?: string
  gitOrg?: string
}

interface FakeGeneration {
  prompt?: string
  generatedCode?: string
  files?: Record<string, string> | null
}

const CLEAN_CODE = `
export default function App() {
  useEffect(() => { fetch('/api/db/visitors', { method: 'POST' }) }, [])
  return (
    <main aria-label="App" data-agent-manifest="true">
      <a href="#content" data-agent-action="skip-nav">Skip to content</a>
      <script type="application/ld+json">{'{}'}</script>
      <h1 id="content">Hello</h1>
    </main>
  )
}
`

const FAKE_LEAD_CAPTURE_CODE = `
export default function App() {
  const [email, setEmail] = useState('')
  const handleSubmit = () => {
    if (email.trim()) {
      alert('Thanks for your interest, we will contact you at ' + email)
      setEmail('')
    }
  }
  return (
    <main aria-label="App">
      <form onSubmit={handleSubmit}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </form>
    </main>
  )
}
`

async function load(opts: {
  apps: FakeApp[]
  registryOk?: boolean
  generations?: Record<string, FakeGeneration | null>
  /** scope_key → existing non-terminal tasks, by slug. */
  existingTasksBySlug?: Record<string, { stage: string; title: string }[]>
  createTaskFails?: boolean
}) {
  const listAllAppsWithStatus = vi.fn(async () => ({
    apps: opts.apps,
    ok: opts.registryOk !== false,
  }))
  const loadGeneration = vi.fn(async (chatId: string) => {
    const gens = opts.generations || {}
    if (!(chatId in gens)) return null
    const gen = gens[chatId]
    if (gen === null) throw new Error('durable read blew up')
    return gen
  })
  const createTask = vi.fn(async (_scopeKey: string, input: any) => {
    if (opts.createTaskFails) return null
    return { id: 't_fake', scopeKey: _scopeKey, stage: 'todo', source: 'cody', ...input }
  })
  const listTasksForCompany = vi.fn(async (slug: string) => {
    return (opts.existingTasksBySlug || {})[slug] || []
  })
  const chatScopeKey = (ownerKey: string, companySlug: string) => `${ownerKey}::${companySlug}`
  const openIssueForNewTask = vi.fn(async (_scopeKey: string, _gitOrg: unknown, _slug: string, task: unknown) => task)

  vi.doMock('@/lib/build/app-registry', () => ({ listAllAppsWithStatus }))
  vi.doMock('@/lib/zerodb-store', () => ({ loadGeneration }))
  vi.doMock('@/lib/build/task-store', () => ({ createTask, listTasksForCompany }))
  vi.doMock('@/lib/build/task-resolver', () => ({ openIssueForNewTask }))
  vi.doMock('@/lib/build/chat-store', () => ({ chatScopeKey }))

  const mod = await import('@/lib/build/obedience-backfill')
  return { ...mod, listAllAppsWithStatus, loadGeneration, createTask, listTasksForCompany, openIssueForNewTask }
}

describe('runObedienceBackfillSweep — leaving clean companies alone', () => {
  it('does not file a task for a company with no obedience gap', async () => {
    const { runObedienceBackfillSweep, createTask } = await load({
      apps: [{ slug: 'shingle', chatId: 'chat-shingle' }],
      generations: { 'chat-shingle': { generatedCode: CLEAN_CODE } },
    })

    const r = await runObedienceBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(1)
    expect(r.gapsFound).toBe(0)
    expect(r.tasksFiled).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'shingle', disposition: 'clean' })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('skips a company with no chatId on record', async () => {
    const { runObedienceBackfillSweep, loadGeneration } = await load({
      apps: [{ slug: 'no-chat-id' }],
    })

    const r = await runObedienceBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'no-chat-id', disposition: 'no_chat_id' })
    expect(loadGeneration).not.toHaveBeenCalled()
  })

  it('skips a soft-deleted company — never re-checked, never re-filed against', async () => {
    const { runObedienceBackfillSweep, loadGeneration } = await load({
      apps: [{ slug: 'gone', chatId: 'chat-gone', lifecycleStatus: 'deleted' }],
      generations: { 'chat-gone': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
    })

    const r = await runObedienceBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(loadGeneration).not.toHaveBeenCalled()
  })

  it('reports a company whose durable code could not be loaded, rather than treating it as clean', async () => {
    const { runObedienceBackfillSweep } = await load({
      apps: [{ slug: 'no-durable-copy', chatId: 'chat-missing' }],
      generations: {},
    })

    const r = await runObedienceBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'no-durable-copy', disposition: 'no_code' })
  })
})

describe('runObedienceBackfillSweep — filing a task for a real gap', () => {
  it('dry run reports would_file_task and files nothing', async () => {
    const { runObedienceBackfillSweep, createTask } = await load({
      apps: [{ slug: 'beacon', chatId: 'chat-beacon' }],
      generations: { 'chat-beacon': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
    })

    const r = await runObedienceBackfillSweep({ dryRun: true })

    expect(r.dryRun).toBe(true)
    expect(r.gapsFound).toBe(1)
    expect(r.tasksFiled).toBe(0)
    expect(r.results[0].disposition).toBe('would_file_task')
    expect(r.results[0].reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('Email/waitlist capture form never persists')]),
    )
    expect(createTask).not.toHaveBeenCalled()
  })

  it('real run files a task with the same title/detail shape #1140 uses in chat-ws', async () => {
    const { runObedienceBackfillSweep, createTask } = await load({
      apps: [{ slug: 'beacon', chatId: 'chat-beacon', ownerEmail: 'founder@example.com' }],
      generations: { 'chat-beacon': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
    })

    const r = await runObedienceBackfillSweep({ dryRun: false })

    expect(r.tasksFiled).toBe(1)
    expect(r.results[0].disposition).toBe('filed_task')
    expect(createTask).toHaveBeenCalledWith(
      'founder@example.com::beacon',
      expect.objectContaining({
        title: expect.stringContaining('Fix generation compliance gap:'),
        stage: 'todo',
        source: 'cody',
      }),
    )
  })

  it('#1973-class gap: opens the filed task\'s real Gitea issue immediately rather than leaving it for a future tier-capped nightly pass', async () => {
    const { runObedienceBackfillSweep, createTask, openIssueForNewTask } = await load({
      apps: [{ slug: 'beacon', chatId: 'chat-beacon', ownerEmail: 'founder@example.com', gitOrg: 'beacon-org' }],
      generations: { 'chat-beacon': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
    })

    await runObedienceBackfillSweep({ dryRun: false })

    expect(createTask).toHaveBeenCalled()
    const filedTask = await createTask.mock.results[0].value
    expect(openIssueForNewTask).toHaveBeenCalledWith('founder@example.com::beacon', 'beacon-org', 'beacon', filedTask)
  })

  it('#1973-class gap: never opens an issue when createTask itself returned nothing', async () => {
    const { runObedienceBackfillSweep, openIssueForNewTask } = await load({
      apps: [{ slug: 'beacon', chatId: 'chat-beacon', ownerEmail: 'founder@example.com', gitOrg: 'beacon-org' }],
      generations: { 'chat-beacon': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
      createTaskFails: true,
    })

    await runObedienceBackfillSweep({ dryRun: false })

    expect(openIssueForNewTask).not.toHaveBeenCalled()
  })

  it('falls back to guest:anon scope when the company has no ownerEmail', async () => {
    const { runObedienceBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: { 'chat-wrench': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
    })

    await runObedienceBackfillSweep({ dryRun: false })

    expect(createTask).toHaveBeenCalledWith('guest:anon::wrench', expect.anything())
  })

  it('reads the multi-file durable map when present instead of the single-file blob', async () => {
    const { runObedienceBackfillSweep } = await load({
      apps: [{ slug: 'multi', chatId: 'chat-multi' }],
      generations: {
        'chat-multi': {
          generatedCode: CLEAN_CODE,
          files: { '/src/App.tsx': FAKE_LEAD_CAPTURE_CODE },
        },
      },
    })

    const r = await runObedienceBackfillSweep({ dryRun: true })

    // Single-file blob is clean; the real gap only exists in the files map —
    // the sweep must have scanned the map, not the fallback blob.
    expect(r.gapsFound).toBe(1)
    expect(r.results[0].disposition).toBe('would_file_task')
  })
})

describe('runObedienceBackfillSweep — idempotency and failure handling', () => {
  it('does not file a second task when a non-terminal task for the same gap already exists', async () => {
    const { runObedienceBackfillSweep, createTask } = await load({
      apps: [{ slug: 'beacon', chatId: 'chat-beacon' }],
      generations: { 'chat-beacon': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
      existingTasksBySlug: {
        beacon: [
          {
            stage: 'todo',
            title: 'Fix generation compliance gap: Email/waitlist capture form never persists the email it collects — must save via /api/db.',
          },
        ],
      },
    })

    const r = await runObedienceBackfillSweep({ dryRun: false })

    expect(r.results[0]).toMatchObject({ slug: 'beacon', disposition: 'already_tracked' })
    expect(r.tasksFiled).toBe(0)
    expect(createTask).not.toHaveBeenCalled()
  })

  it('DOES re-file when the only existing task for the same gap is terminal (completed)', async () => {
    const { runObedienceBackfillSweep, createTask } = await load({
      apps: [{ slug: 'beacon', chatId: 'chat-beacon' }],
      generations: { 'chat-beacon': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
      existingTasksBySlug: {
        beacon: [
          {
            stage: 'completed',
            title: 'Fix generation compliance gap: Email/waitlist capture form never persists the email it collects — must save via /api/db.',
          },
        ],
      },
    })

    const r = await runObedienceBackfillSweep({ dryRun: false })

    expect(r.results[0].disposition).toBe('filed_task')
    expect(createTask).toHaveBeenCalled()
  })

  it('reports file_failed (never crashes) when createTask returns null', async () => {
    const { runObedienceBackfillSweep } = await load({
      apps: [{ slug: 'beacon', chatId: 'chat-beacon' }],
      generations: { 'chat-beacon': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
      createTaskFails: true,
    })

    const r = await runObedienceBackfillSweep({ dryRun: false })

    expect(r.failed).toBe(1)
    expect(r.results[0].disposition).toBe('file_failed')
  })

  it('a failed registry read is reported as registryOk:false, never as zero gaps found', async () => {
    const { runObedienceBackfillSweep } = await load({
      apps: [],
      registryOk: false,
    })

    const r = await runObedienceBackfillSweep({ dryRun: false })

    expect(r.registryOk).toBe(false)
    expect(r.checked).toBe(0)
    expect(r.results).toEqual([])
  })

  it('dry run is the default when no options are passed', async () => {
    const { runObedienceBackfillSweep, createTask } = await load({
      apps: [{ slug: 'beacon', chatId: 'chat-beacon' }],
      generations: { 'chat-beacon': { generatedCode: FAKE_LEAD_CAPTURE_CODE } },
    })

    const r = await runObedienceBackfillSweep()

    expect(r.dryRun).toBe(true)
    expect(createTask).not.toHaveBeenCalled()
  })

  it('--only scopes the sweep to named companies', async () => {
    const { runObedienceBackfillSweep, loadGeneration } = await load({
      apps: [
        { slug: 'beacon', chatId: 'chat-beacon' },
        { slug: 'wrench', chatId: 'chat-wrench' },
      ],
      generations: {
        'chat-beacon': { generatedCode: FAKE_LEAD_CAPTURE_CODE },
        'chat-wrench': { generatedCode: FAKE_LEAD_CAPTURE_CODE },
      },
    })

    const r = await runObedienceBackfillSweep({ dryRun: true, onlySlugs: ['wrench'] })

    expect(r.checked).toBe(1)
    expect(r.results.map((x) => x.slug)).toEqual(['wrench'])
    expect(loadGeneration).toHaveBeenCalledTimes(1)
  })
})
