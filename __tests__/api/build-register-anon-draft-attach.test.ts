/**
 * #1466 (BLD-03) — a pre-auth idea/draft saved via /api/build/anon-draft
 * (lib/build/anon-drafts.ts) was never attached to the account on signup.
 * register/route.ts imported neither loadAnonDraft nor read any submitted
 * token — this file proves that gap, then proves the fix: a submitted
 * anonDraftToken is loaded server-side and its idea/track/answers are
 * returned to the client so the newly-created founder's workspace can be
 * seeded with it instead of starting blank.
 *
 * lib/build/anon-drafts.ts is mocked — no real ZeroDB network. Mirrors the
 * mock/req() conventions already used by build-register-otp.test.ts and
 * build-register-turnstile.test.ts.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  gclidFromRequest: vi.fn(),
  reportMetaConversion: vi.fn(),
  fbcFromRequest: vi.fn(),
  fbpFromRequest: vi.fn(),
  loadAnonDraft: vi.fn(),
  saveAnonDraft: vi.fn(),
}))

vi.mock('@/lib/build/conversions', () => ({ gclidFromRequest: h.gclidFromRequest }))
vi.mock('@/lib/build/meta-capi', () => ({
  reportMetaConversion: h.reportMetaConversion,
  fbcFromRequest: h.fbcFromRequest,
  fbpFromRequest: h.fbpFromRequest,
}))
vi.mock('@/lib/build/anon-drafts', () => ({
  loadAnonDraft: h.loadAnonDraft,
  saveAnonDraft: h.saveAnonDraft,
}))

import * as anonDrafts from '@/lib/build/anon-drafts'
import { POST } from '@/app/api/build/register/route'

function req(body: unknown, opts: { cookie?: string; ip?: string } = {}) {
  return {
    json: async () => body,
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase()
        if (key === 'cookie') return opts.cookie || null
        if (key === 'x-forwarded-for') return opts.ip || null
        return null
      },
    },
  } as any
}

function coreOk(json: unknown, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => json }
}

describe('POST /api/build/register — anon draft attach on signup (#1466)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    h.gclidFromRequest.mockReset().mockReturnValue(null)
    h.reportMetaConversion.mockReset().mockResolvedValue(true)
    h.fbcFromRequest.mockReset().mockReturnValue(undefined)
    h.fbpFromRequest.mockReset().mockReturnValue(undefined)
    h.loadAnonDraft.mockReset()
    h.saveAnonDraft.mockReset()
    fetchMock = vi.fn().mockResolvedValue(
      coreOk({ email_verification_required: false, user: { email_verified: true } }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('imports loadAnonDraft from lib/build/anon-drafts (proves the route is wired up, not just importable)', () => {
    // Today's bug: register/route.ts never imports anon-drafts.ts at all.
    expect(typeof anonDrafts.loadAnonDraft).toBe('function')
  })

  it('calls loadAnonDraft with the submitted anonDraftToken on a successful registration', async () => {
    h.loadAnonDraft.mockResolvedValue(null)
    const res = await POST(req({
      email: 'founder@example.com',
      password: 'longenough1',
      anonDraftToken: 'tok-abc-123',
    }))
    expect(res.status).toBe(200)
    expect(h.loadAnonDraft).toHaveBeenCalledWith('tok-abc-123')
  })

  it('attaches a real draft (idea/track/answers) to the response when one exists for the token', async () => {
    h.loadAnonDraft.mockResolvedValue({
      idea: 'A marketplace for vintage synths',
      track: 'company',
      answers: { audience: 'musicians' },
      step: 'kickoff-2',
    })
    const res = await POST(req({
      email: 'founder@example.com',
      password: 'longenough1',
      anonDraftToken: 'tok-with-draft',
    }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.draft).toEqual({
      idea: 'A marketplace for vintage synths',
      track: 'company',
      answers: { audience: 'musicians' },
    })
  })

  it('returns draft:null when no anonDraftToken is submitted — never calls loadAnonDraft with an empty token', async () => {
    const res = await POST(req({ email: 'founder@example.com', password: 'longenough1' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.draft).toBeNull()
    expect(h.loadAnonDraft).not.toHaveBeenCalled()
  })

  it('returns draft:null when the token has no saved draft', async () => {
    h.loadAnonDraft.mockResolvedValue(null)
    const res = await POST(req({
      email: 'founder@example.com',
      password: 'longenough1',
      anonDraftToken: 'tok-no-draft',
    }))
    const body = await res.json()
    expect(body.draft).toBeNull()
  })

  it('is best-effort: a loadAnonDraft rejection never blocks registration itself', async () => {
    h.loadAnonDraft.mockRejectedValue(new Error('zerodb timeout'))
    const res = await POST(req({
      email: 'founder@example.com',
      password: 'longenough1',
      anonDraftToken: 'tok-boom',
    }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.draft).toBeNull()
  })

  it('never calls loadAnonDraft when registration itself fails at core', async () => {
    fetchMock.mockResolvedValue(coreOk({ detail: 'email already registered' }, 409))
    const res = await POST(req({
      email: 'founder@example.com',
      password: 'longenough1',
      anonDraftToken: 'tok-should-not-load',
    }))
    expect(res.status).toBe(409)
    expect(h.loadAnonDraft).not.toHaveBeenCalled()
  })
})
