import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  setLoopEnabled: vi.fn(),
  setAppLifecycle: vi.fn(),
  resolveAppVerified: vi.fn(),
  releaseZeroVoiceNumber: vi.fn(),
  deleteCustomDomain: vi.fn(),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ setLoopEnabled: h.setLoopEnabled }))
vi.mock('@/lib/build/app-registry', () => ({ setAppLifecycle: h.setAppLifecycle, resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/zerovoice', () => ({ releaseZeroVoiceNumber: h.releaseZeroVoiceNumber }))
vi.mock('@/lib/build/railway-deploy', () => ({ deleteCustomDomain: h.deleteCustomDomain }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { applyDangerAction } from '@/lib/build/danger-zone'

describe('applyDangerAction — delete releases provisioned resources (#SEP-02)', () => {
  beforeEach(() => {
    h.setLoopEnabled.mockReset().mockResolvedValue(true)
    h.setAppLifecycle.mockReset().mockResolvedValue(true)
    h.resolveAppVerified.mockReset()
    h.releaseZeroVoiceNumber.mockReset()
    h.deleteCustomDomain.mockReset()
  })

  it('releases a provisioned ZeroVoice number and BYO domain, using the founder JWT', async () => {
    h.resolveAppVerified.mockResolvedValue({
      verified: true,
      entry: { slug: 'acme', zerovoiceNumberId: 'num_123', byoDomainId: 'cd_456' },
    })
    h.releaseZeroVoiceNumber.mockResolvedValue({ ok: true })
    h.deleteCustomDomain.mockResolvedValue({ ok: true })

    const outcome = await applyDangerAction({
      action: 'delete', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: 'acme',
    }, 'founder-real-jwt')

    expect(h.releaseZeroVoiceNumber).toHaveBeenCalledWith('founder-real-jwt', 'num_123')
    expect(h.deleteCustomDomain).toHaveBeenCalledWith('cd_456')
    expect(outcome.ok).toBe(true)
    expect(outcome.zerovoiceReleased).toBe(true)
    expect(outcome.byoDomainReleased).toBe(true)
    expect(outcome.lifecycleChanged).toBe(true)
    expect(outcome.resourceReleaseUnverified).toBeUndefined()
  })

  it('skips release calls entirely for a company with neither resource provisioned', async () => {
    h.resolveAppVerified.mockResolvedValue({ verified: true, entry: { slug: 'acme' } })

    const outcome = await applyDangerAction({
      action: 'delete', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: 'acme',
    }, 'founder-real-jwt')

    expect(h.releaseZeroVoiceNumber).not.toHaveBeenCalled()
    expect(h.deleteCustomDomain).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
    expect(outcome.lifecycleChanged).toBe(true)
    expect(outcome.resourceReleaseUnverified).toBeUndefined()
  })

  it('flags resourceReleaseUnverified (instead of silently matching "nothing provisioned") when the registry lookup itself fails', async () => {
    h.resolveAppVerified.mockResolvedValue({ verified: false, entry: null })

    const outcome = await applyDangerAction({
      action: 'delete', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: 'acme',
    }, 'founder-real-jwt')

    expect(h.releaseZeroVoiceNumber).not.toHaveBeenCalled()
    expect(h.deleteCustomDomain).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
    expect(outcome.lifecycleChanged).toBe(true)
    expect(outcome.resourceReleaseUnverified).toBe(true)
  })

  it('still completes the delete (lifecycle flip) when a release call fails', async () => {
    h.resolveAppVerified.mockResolvedValue({ verified: true, entry: { slug: 'acme', zerovoiceNumberId: 'num_123' } })
    h.releaseZeroVoiceNumber.mockResolvedValue({ ok: false, reason: 'timeout' })

    const outcome = await applyDangerAction({
      action: 'delete', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: 'acme',
    }, 'founder-real-jwt')

    expect(outcome.ok).toBe(true)
    expect(outcome.lifecycleChanged).toBe(true)
    expect(outcome.zerovoiceReleased).toBe(false)
  })

  it('pause/resume/offline actions are unaffected — no release calls, same as before', async () => {
    const outcome = await applyDangerAction({
      action: 'pause', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: '',
    }, 'founder-real-jwt')
    expect(h.releaseZeroVoiceNumber).not.toHaveBeenCalled()
    expect(h.deleteCustomDomain).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
  })
})
