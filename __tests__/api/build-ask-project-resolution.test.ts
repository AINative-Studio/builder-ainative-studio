import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #400 — resolveCompanyProjectId, the /api/build/ask route's helper that
 * resolves a company's own dedicated ZeroDB project id (when it has one) so
 * chat persistence can be scoped there instead of the shared platform
 * project. Mocks resolveApp (the I/O boundary) per this session's established
 * convention.
 */

const h = vi.hoisted(() => ({ resolveApp: vi.fn() }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
// The route module also constructs OpenAI clients at import time — give it
// harmless env so import doesn't throw.
vi.mock('@/app/(auth)/auth', () => ({ auth: vi.fn(async () => null) }))

beforeEach(() => { h.resolveApp.mockReset() })

describe('resolveCompanyProjectId (#400)', () => {
  it('returns the company zerodbProjectId when the company is provisioned', async () => {
    h.resolveApp.mockResolvedValue({ zerodbProjectId: 'company-proj-123' })
    const { resolveCompanyProjectId } = await import('@/app/api/build/ask/route')
    expect(await resolveCompanyProjectId('acme')).toBe('company-proj-123')
  })

  it('returns undefined when the company has no dedicated project yet (falls back to shared)', async () => {
    h.resolveApp.mockResolvedValue({ name: 'Acme' /* no zerodbProjectId */ })
    const { resolveCompanyProjectId } = await import('@/app/api/build/ask/route')
    expect(await resolveCompanyProjectId('acme')).toBeUndefined()
  })

  it('returns undefined when the company is not found', async () => {
    h.resolveApp.mockResolvedValue(null)
    const { resolveCompanyProjectId } = await import('@/app/api/build/ask/route')
    expect(await resolveCompanyProjectId('unknown-slug')).toBeUndefined()
  })

  it('returns undefined (never throws) when resolveApp fails', async () => {
    h.resolveApp.mockRejectedValue(new Error('zerodb unreachable'))
    const { resolveCompanyProjectId } = await import('@/app/api/build/ask/route')
    expect(await resolveCompanyProjectId('acme')).toBeUndefined()
  })

  it('returns undefined for a blank companyId without calling resolveApp', async () => {
    const { resolveCompanyProjectId } = await import('@/app/api/build/ask/route')
    expect(await resolveCompanyProjectId('')).toBeUndefined()
    expect(h.resolveApp).not.toHaveBeenCalled()
  })
})
