import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * checkSmsDeliveryFailureAlert/shouldSendAlert/sendSlackAlert all live in the
 * SAME module and call each other via plain function references — mocking
 * one export via vi.mock's partial-mock pattern does not intercept those
 * same-module calls (the real function still runs). So this test exercises
 * the real cooldown state (shouldSendAlert's module-level lastAlertTime,
 * reset between cases via __resetAlertCooldownsForTests) and the real
 * external boundary (sendSlackAlert's fetch call to Slack) instead of
 * trying to spy on internal same-module calls.
 */
vi.hoisted(() => {
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test'
})

import { checkSmsDeliveryFailureAlert, __resetAlertCooldownsForTests } from '@/lib/jobs/alerting'

describe('checkSmsDeliveryFailureAlert (#BLD-02d)', () => {
  beforeEach(() => {
    __resetAlertCooldownsForTests()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, statusText: 'OK' }) as unknown as Response))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a critical Slack alert with the real error code when the cooldown allows it', async () => {
    await checkSmsDeliveryFailureAlert('30034')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = (fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.attachments[0].text).toContain('30034')
    expect(payload.attachments[0].color).toBe('#ff0000') // critical
  })

  it('does not alert again within the cooldown window', async () => {
    await checkSmsDeliveryFailureAlert('30034')
    expect(fetch).toHaveBeenCalledTimes(1)
    await checkSmsDeliveryFailureAlert('30034')
    expect(fetch).toHaveBeenCalledTimes(1) // still 1 — the second call was suppressed
  })

  it('still alerts (with a generic message) when no error code is given', async () => {
    await checkSmsDeliveryFailureAlert(undefined)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = (fetch as any).mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.attachments[0].text).toMatch(/failed to deliver/i)
  })
})
