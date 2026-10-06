import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  setLoopEnabled: vi.fn(),
  setAppLifecycle: vi.fn(),
  resolveApp: vi.fn(),
  releaseZeroVoiceNumber: vi.fn(),
  deleteCustomDomain: vi.fn(),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ setLoopEnabled: h.setLoopEnabled }))
vi.mock('@/lib/build/app-registry', () => ({ setAppLifecycle: h.setAppLifecycle, resolveApp: h.resolveApp }))
vi.mock('@/lib/build/zerovoice', () => ({ releaseZeroVoiceNumber: h.releaseZeroVoiceNumber }))
vi.mock('@/lib/build/railway-deploy', () => ({ deleteCustomDomain: h.deleteCustomDomain }))

import { applyDangerAction } from '@/lib/build/danger-zone'

describe('applyDangerAction — delete releases provisioned resources (#SEP-02)', () => {
  beforeEach(() => {
    h.setLoopEnabled.mockReset().mockResolvedValue(true)
    h.setAppLifecycle.mockReset().mockResolvedValue(true)
    h.resolveApp.mockReset()
    h.releaseZeroVoiceNumber.mockReset()
    h.deleteCustomDomain.mockReset()
  })

  it('releases a provisioned ZeroVoice number and BYO domain, using the founder JWT', async () => {
    h.resolveApp.mockResolvedValue({
      slug: 'acme', zerovoiceNumberId: 'num_123', byoDomainId: 'cd_456',
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
  })

  it('skips release calls entirely for a company with neither resource provisioned', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme' })

    const outcome = await applyDangerAction({
      action: 'delete', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: 'acme',
    }, 'founder-real-jwt')

    expect(h.releaseZeroVoiceNumber).not.toHaveBeenCalled()
    expect(h.deleteCustomDomain).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
    expect(outcome.lifecycleChanged).toBe(true)
  })

  it('still completes the delete (lifecycle flip) when a release call fails', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', zerovoiceNumberId: 'num_123' })
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
