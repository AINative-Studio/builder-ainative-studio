import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NightlyRunResult } from '@/lib/build/autonomous-loop'

/**
 * lib/build/comms-policy — the #742 fix for the architecture gap where the
 * nightly loop (the one system with a legitimate reason to email a founder
 * about a live company) had no path to #733's real comms capability.
 *
 * Contracts verified:
 *  - hasGenuineUpdate: true for a real 'dispatched' run with a taskId, AND
 *    (per #1309) for a real 'error' run with a non-empty, meaningful
 *    `detail` — false for 'skipped' always, and false for 'error' with no
 *    real detail to share (never fabricate "good news" OR "something broke"
 *    with zero information).
 *  - runNightlyCommsOutreach: sends on the first genuine, non-opted-out,
 *    within-cap run (dispatched OR error-with-detail); skips honestly (with
 *    the real reason) for opt-out, no genuine update, a second call within
 *    the frequency window, no founder email, an unresolvable company, and a
 *    failed send.
 *  - A failed send does not consume the frequency cap (a real send is the
 *    only thing allowed to burn the once-per-window allowance).
 *  - buildOutreachEmail: the error case is framed CLEARLY DIFFERENTLY from
 *    the success case (subject + opening line), grounded only in
 *    `result.detail` — never inventing diagnostic specifics.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  sendCompanyEmail: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/company-email', () => ({ sendCompanyEmail: h.sendCompanyEmail }))

import { hasGenuineUpdate, runNightlyCommsOutreach, buildOutreachEmail } from '@/lib/build/comms-policy'
import { __resetFrequencyCapForTests } from '@/lib/build/frequency-cap'

function makeResult(overrides: Partial<NightlyRunResult> = {}): NightlyRunResult {
  return {
    companyId: 'acme',
    briefing: 'Focus on retention',
    taskId: 'task-1',
    status: 'dispatched',
    detail: 'task queued for the swarm',
    ...overrides,
  }
}

function makeApp(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'acme',
    chatId: 'chat-1',
    name: 'Acme AI',
    ownerEmail: 'founder@acme.dev',
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('hasGenuineUpdate', () => {
  it('is true for a dispatched run with a taskId', () => {
    expect(hasGenuineUpdate(makeResult())).toBe(true)
  })

  it('is false for a skipped run (no API key)', () => {
    expect(hasGenuineUpdate(makeResult({ status: 'skipped', taskId: null }))).toBe(false)
  })

  it('is false for a dispatched status with no taskId (defensive)', () => {
    expect(hasGenuineUpdate(makeResult({ status: 'dispatched', taskId: null }))).toBe(false)
  })

  // #1309 — extending genuine-signal to error-worthy outreach, the fast
  // follow this file's own doc comment called out as reasonable but
  // explicitly out of scope for #742.
  it('is true for an error run with a real, specific detail', () => {
    expect(
      hasGenuineUpdate(makeResult({ status: 'error', taskId: null, detail: 'task submit → HTTP 500 from agent-swarm' })),
    ).toBe(true)
  })

  it('is false for an error run with an empty detail (never fabricate)', () => {
    expect(hasGenuineUpdate(makeResult({ status: 'error', taskId: null, detail: '' }))).toBe(false)
  })

  it('is false for an error run with a whitespace-only detail', () => {
    expect(hasGenuineUpdate(makeResult({ status: 'error', taskId: null, detail: '   ' }))).toBe(false)
  })

  it('is false for an error run with a generic, non-specific detail', () => {
    expect(hasGenuineUpdate(makeResult({ status: 'error', taskId: null, detail: 'error' }))).toBe(false)
  })

  it('is false for an error run with the honest-but-non-committal "not run" placeholder detail', () => {
    // app/api/build/nightly-loop/route.ts seeds outcome.result.detail to
    // 'not run' before the real run executes — that placeholder must never
    // be mistaken for genuine error information if it somehow reaches here.
    expect(hasGenuineUpdate(makeResult({ status: 'error', taskId: null, detail: 'not run' }))).toBe(false)
  })
})

describe('runNightlyCommsOutreach', () => {
  beforeEach(() => {
    h.resolveApp.mockReset()
    h.sendCompanyEmail.mockReset()
    __resetFrequencyCapForTests()
  })

  it('sends on the first genuine run for a company', async () => {
    h.resolveApp.mockResolvedValue(makeApp())
    h.sendCompanyEmail.mockResolvedValue({ ok: true, id: 'email-1' })

    const result = await runNightlyCommsOutreach('acme', 'Acme AI', makeResult())

    expect(result).toEqual({ status: 'sent', emailId: 'email-1' })
    expect(h.sendCompanyEmail).toHaveBeenCalledTimes(1)
    expect(h.sendCompanyEmail).toHaveBeenCalledWith(
      'Acme AI',
      'founder@acme.dev',
      expect.stringContaining('Acme AI'),
      expect.any(String),
      expect.stringContaining('task-1'),
    )
    // #857 — real customer feedback (Greg Rose): the overnight-update email
    // never linked back to the dashboard at all.
    const sentText = h.sendCompanyEmail.mock.calls[0][4] as string
    expect(sentText).toContain('https://builder.ainative.studio/build?screen=live&company=acme')
  })

  it('blocks a second outreach for the same company within the frequency window', async () => {
    h.resolveApp.mockResolvedValue(makeApp())
    h.sendCompanyEmail.mockResolvedValue({ ok: true, id: 'email-1' })

    const first = await runNightlyCommsOutreach('acme', 'Acme AI', makeResult())
    expect(first.status).toBe('sent')

    const second = await runNightlyCommsOutreach('acme', 'Acme AI', makeResult({ taskId: 'task-2' }))
    expect(second).toEqual({ status: 'skipped', reason: 'rate_limited' })
    expect(h.sendCompanyEmail).toHaveBeenCalledTimes(1)
  })

  it('does not block a DIFFERENT company within the same window', async () => {
    h.sendCompanyEmail.mockResolvedValue({ ok: true, id: 'email-1' })
    h.resolveApp.mockResolvedValueOnce(makeApp({ slug: 'acme' }))
    const first = await runNightlyCommsOutreach('acme', 'Acme AI', makeResult())
    expect(first.status).toBe('sent')

    h.resolveApp.mockResolvedValueOnce(makeApp({ slug: 'beacon', ownerEmail: 'founder@beacon.co' }))
    const second = await runNightlyCommsOutreach('beacon', 'Beacon', makeResult())
    expect(second.status).toBe('sent')
    expect(h.sendCompanyEmail).toHaveBeenCalledTimes(2)
  })

  it('skips honestly when the founder has opted out', async () => {
    h.resolveApp.mockResolvedValue(makeApp({ commsOptOut: true }))

    const result = await runNightlyCommsOutreach('acme', 'Acme AI', makeResult())

    expect(result).toEqual({ status: 'skipped', reason: 'opted_out' })
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('skips honestly when there is nothing genuine to report', async () => {
    h.resolveApp.mockResolvedValue(makeApp())

    const result = await runNightlyCommsOutreach(
      'acme',
      'Acme AI',
      makeResult({ status: 'skipped', taskId: null, detail: 'no AINative API key configured' }),
    )

    expect(result).toEqual({ status: 'skipped', reason: 'no_genuine_update' })
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('skips honestly when there is no founder email on file', async () => {
    h.resolveApp.mockResolvedValue(makeApp({ ownerEmail: undefined }))

    const result = await runNightlyCommsOutreach('acme', 'Acme AI', makeResult())

    expect(result).toEqual({ status: 'skipped', reason: 'no_founder_email' })
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('skips honestly when the company cannot be resolved', async () => {
    h.resolveApp.mockResolvedValue(null)

    const result = await runNightlyCommsOutreach('ghost', 'Ghost Co', makeResult())

    expect(result).toEqual({ status: 'skipped', reason: 'company_not_found' })
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('reports send_failed honestly and does not consume the frequency cap on failure', async () => {
    h.resolveApp.mockResolvedValue(makeApp())
    h.sendCompanyEmail.mockResolvedValueOnce({ ok: false, reason: 'resend_error' })

    const first = await runNightlyCommsOutreach('acme', 'Acme AI', makeResult())
    expect(first).toEqual({ status: 'skipped', reason: 'send_failed' })

    // A failed send must not burn the cap — a retry (e.g. a later run the
    // same night) should still be allowed to actually reach the founder.
    h.sendCompanyEmail.mockResolvedValueOnce({ ok: true, id: 'email-2' })
    const second = await runNightlyCommsOutreach('acme', 'Acme AI', makeResult())
    expect(second).toEqual({ status: 'sent', emailId: 'email-2' })
  })

  it('never throws even if resolveApp itself throws', async () => {
    h.resolveApp.mockRejectedValue(new Error('zerodb down'))

    const result = await runNightlyCommsOutreach('acme', 'Acme AI', makeResult())

    expect(result.status).toBe('skipped')
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  // #1309 — the real gap this issue closes: a genuine error run previously
  // produced ZERO founder communication.
  it('sends an error-framed outreach for a genuine error run with real detail', async () => {
    h.resolveApp.mockResolvedValue(makeApp())
    h.sendCompanyEmail.mockResolvedValue({ ok: true, id: 'email-err-1' })

    const result = await runNightlyCommsOutreach(
      'acme',
      'Acme AI',
      makeResult({ status: 'error', taskId: null, detail: 'task submit → HTTP 500 from agent-swarm' }),
    )

    expect(result).toEqual({ status: 'sent', emailId: 'email-err-1' })
    expect(h.sendCompanyEmail).toHaveBeenCalledTimes(1)
    const sentText = h.sendCompanyEmail.mock.calls[0][4] as string
    expect(sentText).toContain('task submit → HTTP 500 from agent-swarm')
  })

  it('still honestly skips an error run with no real detail to share', async () => {
    h.resolveApp.mockResolvedValue(makeApp())

    const result = await runNightlyCommsOutreach(
      'acme',
      'Acme AI',
      makeResult({ status: 'error', taskId: null, detail: '' }),
    )

    expect(result).toEqual({ status: 'skipped', reason: 'no_genuine_update' })
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('an error-outreach send still respects the per-company frequency cap', async () => {
    h.resolveApp.mockResolvedValue(makeApp())
    h.sendCompanyEmail.mockResolvedValue({ ok: true, id: 'email-err-1' })

    const first = await runNightlyCommsOutreach(
      'acme',
      'Acme AI',
      makeResult({ status: 'error', taskId: null, detail: 'task submit → HTTP 500' }),
    )
    expect(first.status).toBe('sent')

    const second = await runNightlyCommsOutreach(
      'acme',
      'Acme AI',
      makeResult({ status: 'error', taskId: null, detail: 'task submit → HTTP 503' }),
    )
    expect(second).toEqual({ status: 'skipped', reason: 'rate_limited' })
    expect(h.sendCompanyEmail).toHaveBeenCalledTimes(1)
  })

  it('an opted-out founder still never gets an error outreach email', async () => {
    h.resolveApp.mockResolvedValue(makeApp({ commsOptOut: true }))

    const result = await runNightlyCommsOutreach(
      'acme',
      'Acme AI',
      makeResult({ status: 'error', taskId: null, detail: 'task submit → HTTP 500' }),
    )

    expect(result).toEqual({ status: 'skipped', reason: 'opted_out' })
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })
})

describe('buildOutreachEmail (#857)', () => {
  // Real customer feedback (Greg Rose): "It would be great if the emails
  // included a link to that project so I could just click and go there.
  // Maybe with a little marking message like 'click here to jump back in'"
  it('THE FIX: includes a real link back to the Live dashboard', () => {
    const { text } = buildOutreachEmail('acme', 'Acme AI', makeResult())
    expect(text).toContain('https://builder.ainative.studio/build?screen=live&company=acme')
    expect(text).toContain('Jump back in')
  })

  it('URL-encodes a companyId with special characters', () => {
    const { text } = buildOutreachEmail('a company/slug', 'Acme AI', makeResult())
    expect(text).toContain('company=a%20company%2Fslug')
  })

  it('still grounds the email in the real taskId and briefing (never fabricated)', () => {
    const { text } = buildOutreachEmail('acme', 'Acme AI', makeResult({ taskId: 'real-task-42', briefing: 'Focus on retention' }))
    expect(text).toContain('real-task-42')
    expect(text).toContain('Focus on retention')
  })

  // #1309 — error outreach must be unmistakably different framing from the
  // success case, and grounded only in result.detail (never invented).
  describe('error framing', () => {
    it('subject and opening line clearly signal a problem, not progress', () => {
      const successEmail = buildOutreachEmail('acme', 'Acme AI', makeResult())
      const errorEmail = buildOutreachEmail(
        'acme',
        'Acme AI',
        makeResult({ status: 'error', taskId: null, detail: 'task submit → HTTP 500 from agent-swarm' }),
      )

      expect(errorEmail.subject).not.toBe(successEmail.subject)
      expect(errorEmail.text.split('\n')[0]).not.toBe(successEmail.text.split('\n')[0])
      // Never claim a dashboard-worthy "update" happened when the real
      // story is that a run broke.
      expect(errorEmail.subject.toLowerCase()).toMatch(/ran into|issue|problem|trouble|hit a snag/)
    })

    it('grounds the error body only in the real detail string, never a fabricated diagnosis', () => {
      const { text } = buildOutreachEmail(
        'acme',
        'Acme AI',
        makeResult({ status: 'error', taskId: null, detail: 'task submit → HTTP 500 from agent-swarm' }),
      )
      expect(text).toContain('task submit → HTTP 500 from agent-swarm')
    })

    it('still includes the Live dashboard link so the founder can check in', () => {
      const { text } = buildOutreachEmail(
        'acme',
        'Acme AI',
        makeResult({ status: 'error', taskId: null, detail: 'task submit → HTTP 500' }),
      )
      expect(text).toContain('https://builder.ainative.studio/build?screen=live&company=acme')
    })

    it('still signs off in first person as Cody', () => {
      const { text } = buildOutreachEmail(
        'acme',
        'Acme AI',
        makeResult({ status: 'error', taskId: null, detail: 'task submit → HTTP 500' }),
      )
      expect(text).toContain('— Cody')
    })
  })
})
