import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

/**
 * #2134 (ainative-website) / #330 (this repo) — GET /api/build/app-by-project.
 *
 * The AINative dashboard (website repo) shows a user's ZeroDB project but has
 * no way to know whether a Builder app exists for it, since builder_app_registry
 * lives in Builder's own ZeroDB table, not core's Postgres schema. This endpoint
 * closes that gap: given a zerodbProjectId, return the matching Builder app's
 * slug/URLs, so the dashboard can render a real "Open in Builder" link.
 *
 * Auth: HMAC-SHA256 signed token in the `token` query param, same scheme as
 * the existing ad-budget-confirmed webhook (BUILDER_CALLBACK_SECRET) — but
 * signing the query params (project_id + ts) since there is no request body
 * on a GET. Internal service-to-service call, not user-session-gated.
 *
 * Properties under test:
 *  - rejects a request with no token (401);
 *  - rejects a forged/wrong-secret signature (401);
 *  - rejects a stale timestamp (401) — replay protection;
 *  - a genuinely valid, freshly-signed request with a matching project
 *    returns the app's slug/deployUrl/liveUrl;
 *  - a valid signature but no matching project returns { app: null }, not
 *    an error (so "no Builder app yet" is a normal, cacheable response).
 */

const SECRET = 'test-callback-secret'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function sign(projectId: string, ts: number, secret = SECRET): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify({ project_id: projectId, ts })))
  const sig = b64url(createHmac('sha256', secret).update(payloadB64).digest())
  return `${payloadB64}.${sig}`
}

const h = vi.hoisted(() => ({
  listAllApps: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({
  listAllApps: h.listAllApps,
}))

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
const nowSec = () => Math.floor(Date.now() / 1000)

function req(projectId: string | null, token: string | null): any {
  const url = new URL('https://builder.ainative.studio/api/build/app-by-project')
  if (projectId !== null) url.searchParams.set('project_id', projectId)
  if (token !== null) url.searchParams.set('token', token)
  return { nextUrl: url, url: url.toString() } as any
}

const MATCHING_APP = {
  slug: 'acme-social',
  name: 'Acme Social Crossposter',
  chatId: 'chat-1',
  zerodbProjectId: 'proj-abc-123',
  createdAt: '2026-08-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BUILDER_CALLBACK_SECRET = SECRET
  h.listAllApps.mockResolvedValue([MATCHING_APP])
})

afterEach(() => {
  delete process.env.BUILDER_CALLBACK_SECRET
})

describe('GET /api/build/app-by-project (#2134 / #330)', () => {
  it('rejects a request with no token', async () => {
    const { GET } = await import('@/app/api/build/app-by-project/route')
    const res: any = await GET(req('proj-abc-123', null))
    expect(res.status).toBe(401)
    expect(h.listAllApps).not.toHaveBeenCalled()
  })

  it('rejects a request with no project_id', async () => {
    const { GET } = await import('@/app/api/build/app-by-project/route')
    const token = sign('', nowSec())
    const res: any = await GET(req(null, token))
    expect(res.status).toBe(401)
  })

  it('rejects a forged/wrong-secret signature', async () => {
    const { GET } = await import('@/app/api/build/app-by-project/route')
    const token = sign('proj-abc-123', nowSec(), 'wrong-secret')
    const res: any = await GET(req('proj-abc-123', token))
    expect(res.status).toBe(401)
    expect(h.listAllApps).not.toHaveBeenCalled()
  })

  it('rejects a stale timestamp (replay protection)', async () => {
    const { GET } = await import('@/app/api/build/app-by-project/route')
    const staleTs = nowSec() - 20 * 60 // 20 minutes old
    const token = sign('proj-abc-123', staleTs)
    const res: any = await GET(req('proj-abc-123', token))
    expect(res.status).toBe(401)
  })

  it('rejects when the signed project_id does not match the query param (tamper check)', async () => {
    const { GET } = await import('@/app/api/build/app-by-project/route')
    const token = sign('proj-DIFFERENT', nowSec())
    const res: any = await GET(req('proj-abc-123', token))
    expect(res.status).toBe(401)
  })

  it('returns the matching app for a valid, fresh signature', async () => {
    const { GET } = await import('@/app/api/build/app-by-project/route')
    const token = sign('proj-abc-123', nowSec())
    const res: any = await GET(req('proj-abc-123', token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.app).toEqual({
      slug: 'acme-social',
      name: 'Acme Social Crossposter',
      deployUrl: `${APP}/build/acme-social`,
      liveUrl: `${APP}/build?screen=live&company=acme-social`,
    })
  })

  it('returns { app: null } (not an error) when no project matches', async () => {
    const { GET } = await import('@/app/api/build/app-by-project/route')
    const token = sign('proj-no-match', nowSec())
    const res: any = await GET(req('proj-no-match', token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.app).toBeNull()
  })
})
