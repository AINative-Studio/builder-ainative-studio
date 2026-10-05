import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The /api/db proxy scopes each request to the CURRENT company (#331):
//   slug precedence = cookie 'ainative_app' > ?app= query > 'x-ainative-app' header,
//   then slug → provisioned zerodbProjectId (resolveDbProject); else the shared env
//   project. The route's `next/server` import can't load under the node vitest env
//   (mirrors __tests__/api/db-normalize.test.ts, which also avoids importing the
//   route), so we test the two pure seams the route composes — pickAppSlug
//   (precedence) and resolveDbProject (project resolution + env fallback) — plus the
//   route's fallback contract restated here.

vi.hoisted(() => {
  process.env.ZERODB_PROJECT_ID = 'env-shared-project'
  process.env.AINATIVE_API_KEY = 'builder-key'
})

import { pickAppSlug, resolveDbProject } from '@/lib/build/app-registry'

const DEFAULT_PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'

/** Restates the route's resolveScope logic against the two pure seams, so the
 *  precedence + env-fallback contract is asserted end-to-end. */
async function resolveEffectiveProject(signals: {
  cookie?: string | null
  query?: string | null
  header?: string | null
}): Promise<string> {
  const slug = pickAppSlug(signals)
  if (slug) {
    const { projectId } = await resolveDbProject(slug)
    if (projectId) return projectId
  }
  return DEFAULT_PROJECT_ID
}

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}
function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

// =======================================
// pickAppSlug — precedence
// =======================================
describe('pickAppSlug precedence (#331): cookie > query > header', () => {
  it('cookie wins over query and header', () => {
    expect(pickAppSlug({ cookie: 'acme', query: 'other', header: 'third' })).toBe('acme')
  })
  it('query wins when there is no cookie', () => {
    expect(pickAppSlug({ query: 'acme', header: 'third' })).toBe('acme')
  })
  it('header is used when there is no cookie or query', () => {
    expect(pickAppSlug({ header: 'acme' })).toBe('acme')
  })
  it('returns empty string when no signal is present (→ env fallback)', () => {
    expect(pickAppSlug({})).toBe('')
    expect(pickAppSlug({ cookie: null, query: null, header: null })).toBe('')
  })
  it('trims whitespace and ignores blank signals', () => {
    expect(pickAppSlug({ cookie: '   ', query: '  acme  ' })).toBe('acme')
  })
})

// =======================================
// effective project resolution (precedence + provisioning + env fallback)
// =======================================
describe('/api/db effective project resolution (#331)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('cookie slug → the company\'s provisioned project (not the shared env one)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { zerodbProjectId: 'proj-acme' })]))
    const projectId = await resolveEffectiveProject({ cookie: 'acme', query: 'other' })
    expect(projectId).toBe('proj-acme')
    expect(projectId).not.toBe('env-shared-project')
  })

  it('no slug context → shared env project (guest/anonymous keeps working)', async () => {
    const projectId = await resolveEffectiveProject({})
    expect(projectId).toBe('env-shared-project')
    expect(fetch).not.toHaveBeenCalled() // never even hits the registry
  })

  it('slug present but NOT provisioned → shared env project (backward compatible)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')])) // no zerodbProjectId
    const projectId = await resolveEffectiveProject({ cookie: 'acme' })
    expect(projectId).toBe('env-shared-project')
  })

  it('registry lookup error → shared env project (never throws, fail-open)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('registry down'))
    const projectId = await resolveEffectiveProject({ cookie: 'acme' })
    expect(projectId).toBe('env-shared-project')
  })
})
