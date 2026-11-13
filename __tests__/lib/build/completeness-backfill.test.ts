import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1990 — one-shot backlog backfill for completeness-gate gaps already live
 * in production.
 *
 * THE BUG: `findMissingLocalImports()`/`findUndeclaredJsxComponents()` only
 * ever run against a generation at the moment `checkAppReady()` gates it
 * before persistence. Nothing re-checks a company's CURRENT durable code
 * outside that moment, so a truncated multi-file payload that predates the
 * gate (or a given call path gaining it) sits live and untracked
 * indefinitely. Confirmed live for "Agentive" (#1990): 3 of 5 dashboard
 * panels import components that were never emitted anywhere in the payload.
 *
 * The invariants these tests protect (same shape as obedience-backfill.test.ts):
 *  - A company with no completeness gap is left alone (no task filed).
 *  - A company with a real gap (missing import OR undeclared JSX) gets a
 *    task filed with a title/detail shape the existing Gitea resolver
 *    pipeline recognizes identically to any other createTask() call.
 *  - A company that already has a non-terminal task for the same gap is
 *    never double-filed (idempotent re-run).
 *  - A company with no chatId, or whose durable code can't be loaded, is
 *    reported honestly rather than crashing or being silently skipped as
 *    "clean".
 *  - A failed registry read is never reported as "every company is clean".
 *  - Dry run is the default: an accidental call files no tasks.
 *  - A soft-deleted company is never re-checked or re-filed against.
 *  - The durable multi-file map, when present, is the authority — not the
 *    single-file fallback blob.
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
}

interface FakeGeneration {
  prompt?: string
  generatedCode?: string
  files?: Record<string, string> | null
}

const CLEAN_CODE = `
export default function App() {
  return (
    <main aria-label="App">
      <h1>Hello</h1>
    </main>
  )
}
`

/** Imports Analytics but never defines it anywhere — the #333/beacon repro shape. */
const MISSING_IMPORT_CODE = `
import Analytics from './components/Analytics'
export default function App() {
  return (
    <main aria-label="App">
      <Analytics />
    </main>
  )
}
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

  vi.doMock('@/lib/build/app-registry', () => ({ listAllAppsWithStatus }))
  vi.doMock('@/lib/zerodb-store', () => ({ loadGeneration }))
  vi.doMock('@/lib/build/task-store', () => ({ createTask, listTasksForCompany }))
  vi.doMock('@/lib/build/chat-store', () => ({ chatScopeKey }))

  const mod = await import('@/lib/build/completeness-backfill')
  return { ...mod, listAllAppsWithStatus, loadGeneration, createTask, listTasksForCompany }
}

describe('runCompletenessBackfillSweep — leaving clean companies alone', () => {
  it('does not file a task for a company with no completeness gap', async () => {
    const { runCompletenessBackfillSweep, createTask } = await load({
      apps: [{ slug: 'shingle', chatId: 'chat-shingle' }],
      generations: { 'chat-shingle': { generatedCode: CLEAN_CODE } },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(1)
    expect(r.gapsFound).toBe(0)
    expect(r.tasksFiled).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'shingle', disposition: 'clean' })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('skips a company with no chatId on record', async () => {
    const { runCompletenessBackfillSweep, loadGeneration } = await load({
      apps: [{ slug: 'no-chat-id' }],
    })

    const r = await runCompletenessBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'no-chat-id', disposition: 'no_chat_id' })
    expect(loadGeneration).not.toHaveBeenCalled()
  })

  it('skips a soft-deleted company — never re-checked, never re-filed against', async () => {
    const { runCompletenessBackfillSweep, loadGeneration } = await load({
      apps: [{ slug: 'gone', chatId: 'chat-gone', lifecycleStatus: 'deleted' }],
      generations: { 'chat-gone': { generatedCode: MISSING_IMPORT_CODE } },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(loadGeneration).not.toHaveBeenCalled()
  })

  it('reports a company whose durable code could not be loaded, rather than treating it as clean', async () => {
    const { runCompletenessBackfillSweep } = await load({
      apps: [{ slug: 'no-durable-copy', chatId: 'chat-missing' }],
      generations: {},
    })

    const r = await runCompletenessBackfillSweep({ dryRun: false })

    expect(r.checked).toBe(0)
    expect(r.results[0]).toMatchObject({ slug: 'no-durable-copy', disposition: 'no_code' })
  })
})

describe('runCompletenessBackfillSweep — filing a task for a real gap', () => {
  it('dry run reports would_file_task and files nothing', async () => {
    const { runCompletenessBackfillSweep, createTask } = await load({
      apps: [{ slug: 'agentive', chatId: 'chat-agentive' }],
      generations: { 'chat-agentive': { generatedCode: MISSING_IMPORT_CODE } },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: true })

    expect(r.dryRun).toBe(true)
    expect(r.gapsFound).toBe(1)
    expect(r.tasksFiled).toBe(0)
    expect(r.results[0].disposition).toBe('would_file_task')
    expect(r.results[0].missingImports).toEqual(
      expect.arrayContaining([expect.stringContaining('./components/Analytics')]),
    )
    expect(createTask).not.toHaveBeenCalled()
  })

  it('real run files a task with the standard backlog-task title/detail shape', async () => {
    const { runCompletenessBackfillSweep, createTask } = await load({
      apps: [{ slug: 'agentive', chatId: 'chat-agentive', ownerEmail: 'founder@example.com' }],
      generations: { 'chat-agentive': { generatedCode: MISSING_IMPORT_CODE } },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: false })

    expect(r.tasksFiled).toBe(1)
    expect(r.results[0].disposition).toBe('filed_task')
    expect(createTask).toHaveBeenCalledWith(
      'founder@example.com::agentive',
      expect.objectContaining({
        title: expect.stringContaining('Fix generation completeness gap:'),
        stage: 'todo',
        source: 'cody',
      }),
    )
  })

  it('falls back to guest:anon scope when the company has no ownerEmail', async () => {
    const { runCompletenessBackfillSweep, createTask } = await load({
      apps: [{ slug: 'wrench', chatId: 'chat-wrench' }],
      generations: { 'chat-wrench': { generatedCode: MISSING_IMPORT_CODE } },
    })

    await runCompletenessBackfillSweep({ dryRun: false })

    expect(createTask).toHaveBeenCalledWith('guest:anon::wrench', expect.anything())
  })

  it('reads the multi-file durable map when present instead of the single-file blob', async () => {
    const { runCompletenessBackfillSweep } = await load({
      apps: [{ slug: 'multi', chatId: 'chat-multi' }],
      generations: {
        'chat-multi': {
          generatedCode: CLEAN_CODE,
          files: { '/src/App.tsx': MISSING_IMPORT_CODE },
        },
      },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: true })

    // Single-file blob is clean; the real gap only exists in the files map —
    // the sweep must have scanned the map, not the fallback blob.
    expect(r.gapsFound).toBe(1)
    expect(r.results[0].disposition).toBe('would_file_task')
  })

  it('flags an undeclared JSX component (the inverse gap) when a files map is present', async () => {
    const UNDECLARED_APP = `
      export default function App() {
        return <main><Card /></main>
      }
    `
    const { runCompletenessBackfillSweep } = await load({
      apps: [{ slug: 'undeclared-co', chatId: 'chat-undeclared' }],
      generations: {
        'chat-undeclared': {
          generatedCode: UNDECLARED_APP,
          files: { '/src/App.tsx': UNDECLARED_APP },
        },
      },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: true })

    expect(r.gapsFound).toBe(1)
    expect(r.results[0].undeclaredJsx).toEqual(expect.arrayContaining(['Card']))
  })

  it('flags a truncated component file (#2013 — cut off before any export) via the files map', async () => {
    const TRUNCATED_CONTACT_FORM = `
import React, { useState } from 'react';

const ContactFormSection = () => {
  const [submitted, setSubmitted] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault();
}
}
`
    const { runCompletenessBackfillSweep } = await load({
      apps: [{ slug: 'luminary', chatId: 'chat-luminary' }],
      generations: {
        'chat-luminary': {
          generatedCode: CLEAN_CODE,
          files: {
            '/src/App.tsx': CLEAN_CODE,
            '/src/components/ContactFormSection.tsx': TRUNCATED_CONTACT_FORM,
          },
        },
      },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: true })

    expect(r.gapsFound).toBe(1)
    expect(r.results[0].truncatedFiles).toEqual(['/src/components/ContactFormSection.tsx'])
  })
})

describe('runCompletenessBackfillSweep — idempotency and failure handling', () => {
  it('does not file a second task when a non-terminal task for the same gap already exists', async () => {
    const { runCompletenessBackfillSweep, createTask } = await load({
      apps: [{ slug: 'agentive', chatId: 'chat-agentive' }],
      generations: { 'chat-agentive': { generatedCode: MISSING_IMPORT_CODE } },
      existingTasksBySlug: {
        agentive: [
          {
            stage: 'todo',
            title: 'Fix generation completeness gap: imported local module(s) never defined in the payload: ./components/Analytics',
          },
        ],
      },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: false })

    expect(r.results[0]).toMatchObject({ slug: 'agentive', disposition: 'already_tracked' })
    expect(r.tasksFiled).toBe(0)
    expect(createTask).not.toHaveBeenCalled()
  })

  it('DOES re-file when the only existing task for the same gap is terminal (completed)', async () => {
    const { runCompletenessBackfillSweep, createTask } = await load({
      apps: [{ slug: 'agentive', chatId: 'chat-agentive' }],
      generations: { 'chat-agentive': { generatedCode: MISSING_IMPORT_CODE } },
      existingTasksBySlug: {
        agentive: [
          {
            stage: 'completed',
            title: 'Fix generation completeness gap: imported local module(s) never defined in the payload: ./components/Analytics',
          },
        ],
      },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: false })

    expect(r.results[0].disposition).toBe('filed_task')
    expect(createTask).toHaveBeenCalled()
  })

  it('reports file_failed (never crashes) when createTask returns null', async () => {
    const { runCompletenessBackfillSweep } = await load({
      apps: [{ slug: 'agentive', chatId: 'chat-agentive' }],
      generations: { 'chat-agentive': { generatedCode: MISSING_IMPORT_CODE } },
      createTaskFails: true,
    })

    const r = await runCompletenessBackfillSweep({ dryRun: false })

    expect(r.failed).toBe(1)
    expect(r.results[0].disposition).toBe('file_failed')
  })

  it('a failed registry read is reported as registryOk:false, never as zero gaps found', async () => {
    const { runCompletenessBackfillSweep } = await load({
      apps: [],
      registryOk: false,
    })

    const r = await runCompletenessBackfillSweep({ dryRun: false })

    expect(r.registryOk).toBe(false)
    expect(r.checked).toBe(0)
    expect(r.results).toEqual([])
  })

  it('dry run is the default when no options are passed', async () => {
    const { runCompletenessBackfillSweep, createTask } = await load({
      apps: [{ slug: 'agentive', chatId: 'chat-agentive' }],
      generations: { 'chat-agentive': { generatedCode: MISSING_IMPORT_CODE } },
    })

    const r = await runCompletenessBackfillSweep()

    expect(r.dryRun).toBe(true)
    expect(createTask).not.toHaveBeenCalled()
  })

  it('--only scopes the sweep to named companies', async () => {
    const { runCompletenessBackfillSweep, loadGeneration } = await load({
      apps: [
        { slug: 'agentive', chatId: 'chat-agentive' },
        { slug: 'wrench', chatId: 'chat-wrench' },
      ],
      generations: {
        'chat-agentive': { generatedCode: MISSING_IMPORT_CODE },
        'chat-wrench': { generatedCode: MISSING_IMPORT_CODE },
      },
    })

    const r = await runCompletenessBackfillSweep({ dryRun: true, onlySlugs: ['wrench'] })

    expect(r.checked).toBe(1)
    expect(r.results.map((x) => x.slug)).toEqual(['wrench'])
    expect(loadGeneration).toHaveBeenCalledTimes(1)
  })
})
