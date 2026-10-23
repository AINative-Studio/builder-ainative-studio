import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2) — GET/POST /api/rules and GET/PUT/DELETE
 * /api/rules/[ruleId] had no route-level coverage. Both files are thin CRUD
 * wrappers over rule-enforcement-db.service with real branches worth
 * exercising: zod validation -> 400, not-found -> 404, built-in-rule delete
 * guard -> 403, and a generic 500 on any service throw.
 */

const svc = vi.hoisted(() => ({ getRuleEnforcementDbService: vi.fn() }))
vi.mock('@/lib/services/rule-enforcement-db.service', () => ({
  getRuleEnforcementDbService: svc.getRuleEnforcementDbService,
}))

import { mockGetRequest, mockJsonRequest, mockParams } from '../helpers/api-route-harness'

const validRule = {
  id: 'rule-1',
  name: 'No AI attribution',
  description: 'Never attribute commits to AI tools',
  level: 'error' as const,
  category: 'git' as const,
  contexts: ['commit'],
  enabled: true,
  tags: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#1202 GET /api/rules', () => {
  it('lists rules, applying category/enabled/level filters from the query string', async () => {
    const getRules = vi.fn().mockResolvedValue([{ id: 'rule-1' }])
    svc.getRuleEnforcementDbService.mockReturnValue({ getRules })
    const { GET } = await import('@/app/api/rules/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/rules?category=git&enabled=true&level=error')
    )

    expect(res.status).toBe(200)
    expect(getRules).toHaveBeenCalledWith({ category: 'git', enabled: true, level: 'error' })
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.count).toBe(1)
  })

  it('returns a clean 500 when the service throws', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({
      getRules: vi.fn().mockRejectedValue(new Error('db down')),
    })
    const { GET } = await import('@/app/api/rules/route')

    const res = await GET(mockGetRequest('http://localhost/api/rules'))

    expect(res.status).toBe(500)
    expect((await res.json()).success).toBe(false)
  })
})

describe('#1202 POST /api/rules', () => {
  it('creates a rule and returns 201 when the body validates', async () => {
    const upsertRule = vi.fn().mockResolvedValue({ ...validRule })
    svc.getRuleEnforcementDbService.mockReturnValue({ upsertRule })
    const { POST } = await import('@/app/api/rules/route')

    const res = await POST(mockJsonRequest('http://localhost/api/rules', validRule))

    expect(res.status).toBe(201)
    expect(upsertRule).toHaveBeenCalled()
    expect((await res.json()).success).toBe(true)
  })

  it('returns 400 with validation details when the body fails the zod schema', async () => {
    const { POST } = await import('@/app/api/rules/route')

    const res = await POST(mockJsonRequest('http://localhost/api/rules', { name: '' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Validation error')
  })

  it('returns a clean 500 when the service throws after validation passes', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({
      upsertRule: vi.fn().mockRejectedValue(new Error('db down')),
    })
    const { POST } = await import('@/app/api/rules/route')

    const res = await POST(mockJsonRequest('http://localhost/api/rules', validRule))

    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/rules/[ruleId]', () => {
  it('returns the rule when found', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({
      getRule: vi.fn().mockResolvedValue({ ...validRule }),
    })
    const { GET } = await import('@/app/api/rules/[ruleId]/route')

    const res = await GET(mockGetRequest('http://localhost/api/rules/rule-1'), mockParams({ ruleId: 'rule-1' }))

    expect(res.status).toBe(200)
    expect((await res.json()).rule.id).toBe('rule-1')
  })

  it('returns 404 when the rule does not exist', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({ getRule: vi.fn().mockResolvedValue(null) })
    const { GET } = await import('@/app/api/rules/[ruleId]/route')

    const res = await GET(mockGetRequest('http://localhost/api/rules/missing'), mockParams({ ruleId: 'missing' }))

    expect(res.status).toBe(404)
  })

  it('returns a clean 500 when the service throws', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({
      getRule: vi.fn().mockRejectedValue(new Error('db down')),
    })
    const { GET } = await import('@/app/api/rules/[ruleId]/route')

    const res = await GET(mockGetRequest('http://localhost/api/rules/rule-1'), mockParams({ ruleId: 'rule-1' }))

    expect(res.status).toBe(500)
  })
})

describe('#1202 PUT /api/rules/[ruleId]', () => {
  it('updates an existing rule and returns 200', async () => {
    const getRule = vi.fn().mockResolvedValue({ ...validRule })
    const upsertRule = vi.fn().mockResolvedValue({ ...validRule, name: 'Updated' })
    svc.getRuleEnforcementDbService.mockReturnValue({ getRule, upsertRule })
    const { PUT } = await import('@/app/api/rules/[ruleId]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/rules/rule-1', { name: 'Updated' }, { method: 'PUT' }),
      mockParams({ ruleId: 'rule-1' })
    )

    expect(res.status).toBe(200)
    expect((await res.json()).rule.name).toBe('Updated')
  })

  it('returns 404 when updating a rule that does not exist', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({ getRule: vi.fn().mockResolvedValue(null) })
    const { PUT } = await import('@/app/api/rules/[ruleId]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/rules/missing', { name: 'x' }, { method: 'PUT' }),
      mockParams({ ruleId: 'missing' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 400 when the update body fails validation', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({ getRule: vi.fn().mockResolvedValue({ ...validRule }) })
    const { PUT } = await import('@/app/api/rules/[ruleId]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/rules/rule-1', { level: 'not-a-level' }, { method: 'PUT' }),
      mockParams({ ruleId: 'rule-1' })
    )

    expect(res.status).toBe(400)
  })
})

describe('#1202 DELETE /api/rules/[ruleId]', () => {
  it('deletes a custom (non-built-in) rule and returns 200', async () => {
    const getRule = vi.fn().mockResolvedValue({ ...validRule, rule_set_id: null })
    const deleteRule = vi.fn().mockResolvedValue(undefined)
    svc.getRuleEnforcementDbService.mockReturnValue({ getRule, deleteRule })
    const { DELETE } = await import('@/app/api/rules/[ruleId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/rules/rule-1'),
      mockParams({ ruleId: 'rule-1' })
    )

    expect(res.status).toBe(200)
    expect(deleteRule).toHaveBeenCalledWith('rule-1')
  })

  it('returns 404 when the rule does not exist', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({ getRule: vi.fn().mockResolvedValue(null) })
    const { DELETE } = await import('@/app/api/rules/[ruleId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/rules/missing'),
      mockParams({ ruleId: 'missing' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 and refuses to delete a built-in rule (has rule_set_id)', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({
      getRule: vi.fn().mockResolvedValue({ ...validRule, rule_set_id: 'builtin-set' }),
      deleteRule: vi.fn(),
    })
    const { DELETE } = await import('@/app/api/rules/[ruleId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/rules/rule-1'),
      mockParams({ ruleId: 'rule-1' })
    )

    expect(res.status).toBe(403)
  })

  it('returns a clean 500 when the service throws', async () => {
    svc.getRuleEnforcementDbService.mockReturnValue({
      getRule: vi.fn().mockRejectedValue(new Error('db down')),
    })
    const { DELETE } = await import('@/app/api/rules/[ruleId]/route')

    const res = await DELETE(
      mockGetRequest('http://localhost/api/rules/rule-1'),
      mockParams({ ruleId: 'rule-1' })
    )

    expect(res.status).toBe(500)
  })
})
