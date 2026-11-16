import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Metadata-freshness backlog backfill sweep — one-shot repair for
 * companies whose PERSISTED `/app/layout.tsx` still carries the #1952
 * ("this" literal name) or #2024 ("Ecommerce Application" mislabel)
 * generator bug. See lib/build/metadata-backfill.ts's doc comment for the
 * full incident history and safety posture. Mirrors
 * __tests__/lib/build/obedience-backfill.test.ts's harness conventions.
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

const WRENCH_PROMPT =
  'Build a polished, production-quality single-page marketing LANDING PAGE for "Wrench" ' +
  '(tagline: "From job site to paid — on autopilot.") — a real company for this idea: ' +
  'A field service management platform for small businesses.'

const STALE_LAYOUT = `export const metadata: Metadata = {
  title: 'this — Ecommerce Application',
  description: 'whatever',
  metadataBase: new URL('https://this.app'),
}
export default function RootLayout() { return null }
`

const CLEAN_LAYOUT = `export const metadata: Metadata = {
  title: 'Wrench — Saas Application',
  description: 'whatever',
  metadataBase: new URL('https://wrench.app'),
}
export default function RootLayout() { return null }
`

async function load(opts: {
  apps: FakeApp[]
  registryOk?: boolean
  generations?: Record<string, FakeGeneration | null>
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

  const mod = await import('@/lib/build/metadata-backfill')
  return { ...mod, listAllAppsWithStatus, loadGeneration, createTask, listTasksForCompany, openIssueForNewTask }
}

describe('runMetadataBackfillSweep — leaving clean companies alone', () => {
  it('does not file a task for a company whose layout.tsx is already correct', async () => {
    const { runMetadataBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: {
        'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': CLEAN_LAYOUT } },
      },
    })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(1)
    expect(r.gapsFound).toBe(0)
    expect(r.tasksFiled).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'wrench', disposition: 'clean' })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('skips a company with no chatId on record', async () => {
    const { runMetadataBackfillSweep, loadGeneration } = await load({
      apps: [{ slug: 'no-chat-id' }],
    })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'no-chat-id', disposition: 'no_chat_id' })
    expect(loadGeneration).not.toHaveBeenCalled()
  })

  it('skips a soft-deleted company — never re-checked, never re-filed against', async () => {
    const { runMetadataBackfillSweep, loadGeneration } = await load({
      apps: [{ slug: 'gone', chatId: 'chat-gone', lifecycleStatus: 'deleted' }],
      generations: { 'chat-gone': { files: { '/app/layout.tsx': STALE_LAYOUT } } },
    })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(loadGeneration).not.toHaveBeenCalled()
  })

  it('reports no_code for a company with no persisted /app/layout.tsx (e.g. single-file-only generation) rather than crashing', async () => {
    const { runMetadataBackfillSweep } = await load({
      apps: [{ slug: 'single-file', chatId: 'chat-single' }],
      generations: { 'chat-single': { generatedCode: 'export default function App() { return null }' } },
    })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'single-file', disposition: 'no_code' })
  })
})

describe('runMetadataBackfillSweep — filing a task for a real gap', () => {
  it('dry run reports would_file_task and files nothing', async () => {
    const { runMetadataBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: { 'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } } },
    })

    const r = await runMetadataBackfillSweep({ dryRun: true })

    expect(r.dryRun).toBe(true)
    expect(r.gapsFound).toBe(1)
    expect(r.tasksFiled).toBe(0)
    expect(r.results[0].disposition).toBe('would_file_task')
    expect(r.results[0].reasons!.some((x) => x.includes('#1952'))).toBe(true)
    expect(createTask).not.toHaveBeenCalled()
  })

  it('real run files a task with the same title/detail shape obedience-backfill.ts uses', async () => {
    const { runMetadataBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench', ownerEmail: 'founder@example.com' }],
      generations: { 'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } } },
    })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    expect(r.tasksFiled).toBeGreaterThan(0)
    expect(r.results[0].disposition).toBe('filed_task')
    expect(createTask).toHaveBeenCalledWith(
      'founder@example.com::wrench',
      expect.objectContaining({
        title: expect.stringContaining('Fix generation compliance gap:'),
        stage: 'todo',
        source: 'cody',
      }),
    )
  })

  it('files one task per distinct reason when both bugs are present at once', async () => {
    const { runMetadataBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: { 'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } } },
    })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    expect(r.results[0].reasons!.length).toBeGreaterThanOrEqual(2)
    expect(createTask).toHaveBeenCalledTimes(r.results[0].reasons!.length)
  })

  it('opens the filed task\'s real Gitea issue immediately, same as obedience-backfill.ts', async () => {
    const { runMetadataBackfillSweep, createTask, openIssueForNewTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench', ownerEmail: 'founder@example.com', gitOrg: 'wrench-org' }],
      generations: { 'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } } },
    })

    await runMetadataBackfillSweep({ dryRun: false })

    expect(createTask).toHaveBeenCalled()
    const filedTask = await createTask.mock.results[0].value
    expect(openIssueForNewTask).toHaveBeenCalledWith('founder@example.com::wrench', 'wrench-org', 'wrench', filedTask)
  })

  it('falls back to guest:anon scope when the company has no ownerEmail', async () => {
    const { runMetadataBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: { 'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } } },
    })

    await runMetadataBackfillSweep({ dryRun: false })

    expect(createTask).toHaveBeenCalledWith('guest:anon::wrench', expect.anything())
  })
})

describe('runMetadataBackfillSweep — idempotency and failure handling', () => {
  it('never re-files a reason that already has a non-terminal task tracking it', async () => {
    const { runMetadataBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: { 'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } } },
      existingTasksBySlug: {
        wrench: [
          {
            stage: 'todo',
            title:
              'Fix generation compliance gap: layout.tsx metadataBase is the literal placeholder domain "https://this.app" — the #1952 unanchored-name-scan bug signature (fixed in extractAppMetadata, never backfilled).',
          },
        ],
      },
    })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    // Still a real write (the #2024 reason is NOT tracked), so this must not
    // report already_tracked at the company level.
    expect(r.results[0].disposition).toBe('filed_task')
    const filedTitles = createTask.mock.calls.map((c) => (c[1] as { title: string }).title)
    expect(filedTitles.some((t) => t.includes('#1952'))).toBe(false)
    expect(filedTitles.some((t) => t.includes('#2024'))).toBe(true)
  })

  it('reports already_tracked and files nothing when every reason already has an open task', async () => {
    // Compute the exact reasons checkMetadataFreshness() produces for
    // STALE_LAYOUT directly (pure function, no mocking needed) instead of a
    // second load() in this same test — vi.resetModules() only runs once per
    // test (in beforeEach), so a second load() within one test would reuse
    // the FIRST load()'s cached module/mocks rather than the second's.
    const { checkMetadataFreshness } = await import('@/lib/build/metadata-gate')
    const allTitles = checkMetadataFreshness(WRENCH_PROMPT, '', STALE_LAYOUT).reasons.map(
      (reason) => `Fix generation compliance gap: ${reason}`,
    )

    const { runMetadataBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: { 'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } } },
      existingTasksBySlug: { wrench: allTitles.map((title) => ({ stage: 'todo', title })) },
    })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    expect(r.results[0].disposition).toBe('already_tracked')
    expect(r.tasksFiled).toBe(0)
    expect(createTask).not.toHaveBeenCalled()
  })

  it('a failed registry read is reported as registryOk:false, never as zero gaps found', async () => {
    const { runMetadataBackfillSweep } = await load({ apps: [], registryOk: false })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    expect(r.registryOk).toBe(false)
    expect(r.checked).toBe(0)
    expect(r.results).toEqual([])
  })

  it('dry run is the default when no options are passed', async () => {
    const { runMetadataBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: { 'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } } },
    })

    const r = await runMetadataBackfillSweep()

    expect(r.dryRun).toBe(true)
    expect(createTask).not.toHaveBeenCalled()
  })

  it('--only scopes the sweep to named companies', async () => {
    const { runMetadataBackfillSweep, loadGeneration } = await load({
      apps: [
        { slug: 'wrench', chatId: 'chat-wrench' },
        { slug: 'lumeo', chatId: 'chat-lumeo' },
      ],
      generations: {
        'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } },
        'chat-lumeo': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } },
      },
    })

    const r = await runMetadataBackfillSweep({ dryRun: true, onlySlugs: ['wrench'] })

    expect(r.checked).toBe(1)
    expect(r.results.map((x) => x.slug)).toEqual(['wrench'])
    expect(loadGeneration).toHaveBeenCalledTimes(1)
  })

  it('reports file_failed (never crashes) when createTask returns null', async () => {
    const { runMetadataBackfillSweep } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: { 'chat-wrench': { prompt: WRENCH_PROMPT, files: { '/app/layout.tsx': STALE_LAYOUT } } },
      createTaskFails: true,
    })

    const r = await runMetadataBackfillSweep({ dryRun: false })

    expect(r.failed).toBeGreaterThan(0)
    expect(r.results[0].disposition).toBe('file_failed')
  })
})
