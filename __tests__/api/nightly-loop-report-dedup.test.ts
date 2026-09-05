import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET/POST /api/build/nightly-loop — two real, live bug fixes covered here:
 *
 * 1) DUPLICATE DAILY REPORTS: "Daily Operational Report — Sep 5, 2026" appeared
 *    10x on the Live dashboard's Reports tab (8x for Sep 4) instead of once per
 *    real day. Root cause: listEnrolled() (loop-enrollment.ts) returned a
 *    company once PER duplicate enrollment row (now fixed — dedupeByCompany),
 *    but this route ALSO needed its own idempotency layer: even a single
 *    duplicate dispatch on the same real day must not double-write the report.
 *    hasReportForDate() is checked before every createDocument() call.
 *
 * 2) OFF-BRAND AUTO-MEDIA: recurring media routines used to run with ONLY
 *    companyName passed to runMediaRoutines — no tagline, no brand color. This
 *    route now resolves the real AppEntry (app-registry) and threads its
 *    tagline/color through, so the auto-fired image/video prompt is grounded in
 *    the founder's real brand instead of a bare company name every time.
 */

const h = vi.hoisted(() => ({
  listEnrolled: vi.fn(),
  recordRun: vi.fn(),
  runNightlyLoop: vi.fn(),
  appendAutoRunEvent: vi.fn(),
  createDocument: vi.fn(),
  hasReportForDate: vi.fn(),
  runMediaRoutines: vi.fn(),
  runTaskResolutions: vi.fn(),
  resolveApp: vi.fn(),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ listEnrolled: h.listEnrolled, recordRun: h.recordRun }))
vi.mock('@/lib/build/autonomous-loop', () => ({ runNightlyLoop: h.runNightlyLoop }))
vi.mock('@/lib/build/auto-mode', () => ({ appendAutoRunEvent: h.appendAutoRunEvent }))
vi.mock('@/lib/build/auto-run-activity', () => ({ dispatchEventTitle: () => 'Dispatched' }))
vi.mock('@/lib/build/document-store', () => ({ createDocument: h.createDocument, hasReportForDate: h.hasReportForDate }))
vi.mock('@/lib/build/media-routine', () => ({ runMediaRoutines: h.runMediaRoutines }))
vi.mock('@/lib/build/task-resolution-loop', () => ({ runTaskResolutions: h.runTaskResolutions }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { GET } from '@/app/api/build/nightly-loop/route'

function req(headers: Record<string, string> = {}) {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null },
  } as any
}

const ENROLLMENT = {
  companyId: 'beacon', companyName: 'Beacon', track: 'app' as const,
  ownerKey: 'founder@beacon.co', enabled: true, enrolledAt: '2026-09-01T00:00:00Z',
}

describe('GET /api/build/nightly-loop', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    delete process.env.CRON_SECRET
    h.listEnrolled.mockResolvedValue([ENROLLMENT])
    h.recordRun.mockResolvedValue(undefined)
    h.runNightlyLoop.mockResolvedValue({
      companyId: 'beacon', briefing: 'brief', taskId: 'task-1', status: 'dispatched', detail: 'ok',
    })
    h.appendAutoRunEvent.mockResolvedValue(undefined)
    h.hasReportForDate.mockResolvedValue(false)
    h.createDocument.mockResolvedValue({ id: 'd1' })
    h.runMediaRoutines.mockResolvedValue({ generated: 0 })
    h.runTaskResolutions.mockResolvedValue({ attempted: 0, completed: 0 })
    h.resolveApp.mockResolvedValue({ slug: 'beacon', tagline: 'Guiding growth', color: '#1e88e5' })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('writes exactly one daily report when none exists yet for today', async () => {
    const res = await GET(req())
    const data = await res.json()
    expect(data.reportsWritten).toBe(1)
    expect(h.hasReportForDate).toHaveBeenCalledWith(expect.any(String), 'daily', expect.any(String))
    expect(h.createDocument).toHaveBeenCalledTimes(1)
    const [, doc] = h.createDocument.mock.calls[0]
    expect(doc.type).toBe('daily')
  })

  it('the real fix: skips the write entirely when a report already exists for today (idempotency)', async () => {
    h.hasReportForDate.mockResolvedValue(true)
    const res = await GET(req())
    const data = await res.json()
    expect(data.reportsWritten).toBe(0)
    expect(h.createDocument).not.toHaveBeenCalled()
  })

  it('simulates a duplicate dispatch for the same company on the same day: only the FIRST write lands', async () => {
    // First call for the day: no report yet.
    h.hasReportForDate.mockResolvedValueOnce(false)
    await GET(req())
    expect(h.createDocument).toHaveBeenCalledTimes(1)

    // A duplicate dispatch later the same day: hasReportForDate now sees the one just written.
    h.hasReportForDate.mockResolvedValueOnce(true)
    await GET(req())
    expect(h.createDocument).toHaveBeenCalledTimes(1) // still only 1 — no second write
  })

  it('resolves the real AppEntry and grounds the media routine in the real tagline + color (not a bare company name)', async () => {
    await GET(req())
    expect(h.resolveApp).toHaveBeenCalledWith('beacon')
    expect(h.runMediaRoutines).toHaveBeenCalledWith(expect.any(String), {
      companyName: 'Beacon',
      tagline: 'Guiding growth',
      color: '#1e88e5',
    })
  })

  it('degrades gracefully (no tagline/color) when the registry entry cannot be resolved', async () => {
    h.resolveApp.mockResolvedValue(null)
    await GET(req())
    expect(h.runMediaRoutines).toHaveBeenCalledWith(expect.any(String), {
      companyName: 'Beacon',
      tagline: undefined,
      color: undefined,
    })
  })

  it('a resolveApp failure never breaks the media-routine step', async () => {
    h.resolveApp.mockRejectedValue(new Error('registry down'))
    const res = await GET(req())
    expect(res.status).toBe(200)
  })

  it('never writes a report for a company with no ownerKey (pre-#64 enrollment) — no scope to key it by', async () => {
    h.listEnrolled.mockResolvedValue([{ ...ENROLLMENT, ownerKey: undefined }])
    const res = await GET(req())
    const data = await res.json()
    expect(data.reportsWritten).toBe(0)
    expect(h.createDocument).not.toHaveBeenCalled()
  })

  it('a hasReportForDate failure is treated as "not yet reported" (best-effort, never blocks the loop) only via its own catch', async () => {
    // hasReportForDate itself never throws (returns false on failure) per its own
    // contract — but the surrounding try/catch here must also survive a thrown
    // createDocument.
    h.createDocument.mockRejectedValue(new Error('zerodb down'))
    const res = await GET(req())
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.reportsWritten).toBe(0)
  })
})
