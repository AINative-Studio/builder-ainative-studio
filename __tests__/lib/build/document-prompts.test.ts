import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_PROMPTS,
  isGeneratableDocType,
  dailyReportTitle,
  buildDailyReport,
  type DocGenContext,
  type DailyReportInput,
} from '@/lib/build/document-prompts'

/**
 * #64 — Document generation prompts + the daily-report builder. The daily report
 * is built deterministically from REAL nightly-run data (no model call), so it is
 * fully unit-testable and provably non-fabricated. The durable-doc prompts are
 * checked for the structured quality-bar contract (Executive Summary → Key Findings
 * → Sources, anti-lorem, no invented URLs).
 */

const ctx: DocGenContext = { idea: 'AI inventory copilot for small retailers', companyName: 'ShelfMind', track: 'company' }

// ---------- durable-doc prompts ----------
describe('DOCUMENT_PROMPTS (#64 quality bar)', () => {
  it('covers the four durable starter document types', () => {
    for (const t of ['research', 'roadmap', 'mission', 'market'] as const) {
      expect(DOCUMENT_PROMPTS[t]).toBeTruthy()
      expect(isGeneratableDocType(t)).toBe(true)
    }
  })
  it('daily/note are NOT generatable via Claude (reports are built, notes are authored)', () => {
    expect(isGeneratableDocType('daily' as any)).toBe(false)
    expect(isGeneratableDocType('note' as any)).toBe(false)
  })
  it('every generatable prompt enforces the structured section contract', () => {
    for (const t of ['research', 'roadmap', 'mission', 'market'] as const) {
      const spec = DOCUMENT_PROMPTS[t]!
      // The structure contract requires the three top-level sections + anti-lorem.
      expect(spec.system).toContain('## Executive Summary')
      expect(spec.system).toContain('## Key Findings')
      expect(spec.system).toContain('## Sources')
      expect(spec.system.toLowerCase()).toContain('lorem')
      expect(spec.system.toLowerCase()).toContain('do not invent urls')
    }
  })
  it('grounds the user prompt in the real idea + company name', () => {
    const u = DOCUMENT_PROMPTS.research!.user(ctx)
    expect(u).toContain('ShelfMind')
    expect(u).toContain('AI inventory copilot')
  })
  it('produces sensible per-type default titles', () => {
    expect(DOCUMENT_PROMPTS.research!.title(ctx)).toContain('ShelfMind')
    expect(DOCUMENT_PROMPTS.roadmap!.title(ctx)).toContain('Roadmap')
    expect(DOCUMENT_PROMPTS.mission!.title(ctx)).toContain('Mission')
    expect(DOCUMENT_PROMPTS.market!.title(ctx)).toMatch(/Market Research/i)
  })
  it('every generatable user prompt grounds in the idea + company name', () => {
    for (const t of ['research', 'roadmap', 'mission', 'market'] as const) {
      const u = DOCUMENT_PROMPTS[t]!.user(ctx)
      expect(u).toContain('ShelfMind')
      expect(u).toContain('AI inventory copilot')
    }
  })
})

// ---------- dailyReportTitle ----------
describe('dailyReportTitle (#64)', () => {
  it('includes a formatted date', () => {
    const title = dailyReportTitle({ companyName: 'ShelfMind', runAt: '2026-08-25T02:00:00Z' })
    expect(title).toContain('Daily Operational Report')
    expect(title).toMatch(/Aug/)
    expect(title).toMatch(/2026/)
  })
  it('defaults to now when no runAt', () => {
    expect(dailyReportTitle({ companyName: 'X' })).toContain('Daily Operational Report')
  })
})

// ---------- buildDailyReport ----------
describe('buildDailyReport (#64) — grounded in real run data', () => {
  const base: DailyReportInput = {
    companyName: 'ShelfMind',
    runAt: '2026-08-25T02:00:00Z',
    taskId: 'task-abc',
    status: 'dispatched',
    briefing: 'Pipeline shows 3 qualified leads; landing conversion up 4%.',
    detail: 'task queued for the swarm',
  }

  it('always emits the three structured sections', () => {
    const md = buildDailyReport(base)
    expect(md).toContain('## Executive Summary')
    expect(md).toContain('## Key Findings')
    expect(md).toContain('## Sources')
  })

  it('a dispatched run names the real task id + surfaces the briefing', () => {
    const md = buildDailyReport(base)
    expect(md).toContain('task-abc')
    expect(md).toContain('dispatched')
    expect(md).toContain('Pipeline shows 3 qualified leads')
    // Next actions for a dispatched run tell the founder to poll the task.
    expect(md).toContain('Poll the dispatched swarm task')
  })

  it('a skipped run is HONEST — no fabricated work', () => {
    const md = buildDailyReport({ companyName: 'ShelfMind', status: 'skipped', detail: 'no AINative API key configured' })
    expect(md).toContain('skipped')
    expect(md).toContain('No changes were made overnight')
    expect(md).not.toContain('task queued')
  })

  it('an errored run is flagged for review, not hidden', () => {
    const md = buildDailyReport({ companyName: 'ShelfMind', status: 'error', taskId: null, detail: 'HTTP 402 plan required' })
    expect(md).toContain('did not complete a dispatch')
    expect(md).toContain('flagged for review')
    expect(md).toContain('Investigate why no task was dispatched')
  })

  it('reports honestly when no briefing was available', () => {
    const md = buildDailyReport({ companyName: 'ShelfMind', status: 'dispatched', taskId: 't1', briefing: null })
    expect(md).toContain('No data-informed briefing was available')
    expect(md).toContain('No external briefing source for this run')
  })
})
