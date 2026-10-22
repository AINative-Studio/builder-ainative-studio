import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for RuleEnforcementDbService: drizzle-backed CRUD for the
 * rule enforcement framework (rules, rule sets, violations, reports,
 * configs). All database access goes through `@/lib/db`, mocked here;
 * `built-in-rules.ts` is mocked to a small, deterministic fixture set.
 */

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({
  enforcement_rules: { id: 'id', category: 'category', enabled: 'enabled', level: 'level' },
  rule_sets: {},
  rule_violations: { user_id: 'user_id', project_id: 'project_id', rule_id: 'rule_id', fixed: 'fixed', created_at: 'created_at' },
  enforcement_reports: { user_id: 'user_id', project_id: 'project_id', passed: 'passed', created_at: 'created_at' },
  enforcement_configs: { project_id: 'project_id', user_id: 'user_id' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
  and: vi.fn((...args) => ({ op: 'and', args })),
  desc: vi.fn((col) => ({ op: 'desc', col })),
}))

const getAllBuiltInRulesMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/built-in-rules', () => ({
  getAllBuiltInRules: getAllBuiltInRulesMock,
}))

function thenableQuery(rows: any[]) {
  // Chainable object: .where()/.limit()/.orderBy() all return `this`, and
  // the object itself resolves (via then) to `rows` — mirrors drizzle's own
  // "query builder is also a promise" behavior used by RuleEnforcementDbService,
  // which calls `.where()` repeatedly and sometimes awaits the builder directly.
  const chain: any = {
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    then: (resolve: any) => Promise.resolve(rows).then(resolve),
  }
  return chain
}

function insertChain(opts: { onConflictDoNothingRow?: any; row?: any; onConflictDoUpdate?: boolean } = {}) {
  const builder: any = {
    values: vi.fn(() => builder),
    onConflictDoNothing: vi.fn(() => builder),
    onConflictDoUpdate: vi.fn(() => builder),
    returning: vi.fn(() =>
      Promise.resolve(opts.onConflictDoNothingRow !== undefined ? [opts.onConflictDoNothingRow] : opts.row !== undefined ? [opts.row] : [])
    ),
  }
  return builder
}

function updateChain(row?: any) {
  const builder: any = {
    set: vi.fn(() => builder),
    where: vi.fn(() => (row !== undefined ? { returning: () => Promise.resolve([row]) } : Promise.resolve(undefined))),
  }
  return builder
}

function deleteChain() {
  return { where: vi.fn(() => Promise.resolve(undefined)) }
}

describe('RuleEnforcementDbService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initializeBuiltInRules', () => {
    it('creates the built-in rule set and upserts each built-in rule', async () => {
      getAllBuiltInRulesMock.mockReturnValue([
        {
          id: 'rule-1',
          name: 'No console.log',
          description: 'desc',
          level: 'error',
          category: 'code-quality',
          contexts: ['pre-commit'],
          enabled: true,
          tags: ['quality'],
          docsUrl: undefined,
          examples: undefined,
        },
      ])

      let insertCallCount = 0
      dbMock.insert.mockImplementation(() => {
        insertCallCount += 1
        if (insertCallCount === 1) {
          // rule_sets insert
          return insertChain({ onConflictDoNothingRow: { id: 'ruleset-1' } })
        }
        // enforcement_rules insert
        return insertChain({ row: { id: 'rule-1' } })
      })

      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      await service.initializeBuiltInRules()

      expect(dbMock.insert).toHaveBeenCalledTimes(2)
    })
  })

  describe('getRules', () => {
    it('returns all rules when no filters are given', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([{ id: 'r1' }, { id: 'r2' }]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const result = await service.getRules()
      expect(result).toEqual([{ id: 'r1' }, { id: 'r2' }])
    })

    it('applies category/enabled/level filters without throwing', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([{ id: 'r1' }]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const result = await service.getRules({ category: 'code-quality', enabled: true, level: 'error' })
      expect(result).toEqual([{ id: 'r1' }])
    })
  })

  describe('getRule', () => {
    it('returns the rule when found', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([{ id: 'r1' }]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      expect(await service.getRule('r1')).toEqual({ id: 'r1' })
    })

    it('returns null when not found', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      expect(await service.getRule('missing')).toBeNull()
    })
  })

  describe('upsertRule', () => {
    it('throws when the rule has no id', async () => {
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      await expect(service.upsertRule({ name: 'x' } as any)).rejects.toThrow('Rule ID is required')
    })

    it('upserts and returns the resulting row', async () => {
      dbMock.insert.mockReturnValue(insertChain({ row: { id: 'r1', name: 'My Rule' } }))
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const result = await service.upsertRule({
        id: 'r1',
        name: 'My Rule',
        description: 'desc',
        category: 'code-quality',
      })
      expect(result).toEqual({ id: 'r1', name: 'My Rule' })
    })
  })

  describe('deleteRule', () => {
    it('issues a delete against enforcement_rules', async () => {
      dbMock.delete.mockReturnValue(deleteChain())
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      await expect(service.deleteRule('r1')).resolves.toBeUndefined()
      expect(dbMock.delete).toHaveBeenCalled()
    })
  })

  describe('recordViolation', () => {
    it('records a violation using the action and violation payload', async () => {
      dbMock.insert.mockReturnValue(insertChain({ row: { id: 'viol-1' } }))
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const result = await service.recordViolation(
        'rule-1',
        'user-1',
        { type: 'commit', projectId: 'proj-1', data: { commitMessage: 'fix bug' } } as any,
        { message: 'violation message', autoFixable: false } as any
      )
      expect(result).toEqual({ id: 'viol-1' })
    })
  })

  describe('markViolationFixed', () => {
    it('updates the violation as fixed', async () => {
      dbMock.update.mockReturnValue(updateChain())
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      await expect(service.markViolationFixed('viol-1', 'auto', 500)).resolves.toBeUndefined()
    })
  })

  describe('getViolations', () => {
    it('applies all optional filters and returns matching rows', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([{ id: 'v1' }]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const result = await service.getViolations({
        userId: 'user-1',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fixed: false,
        limit: 10,
      })
      expect(result).toEqual([{ id: 'v1' }])
    })

    it('returns all violations when no filters are given', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([{ id: 'v1' }, { id: 'v2' }]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const result = await service.getViolations({})
      expect(result).toEqual([{ id: 'v1' }, { id: 'v2' }])
    })
  })

  describe('saveReport', () => {
    it('inserts an enforcement report and returns the saved row', async () => {
      dbMock.insert.mockReturnValue(insertChain({ row: { id: 'report-1' } }))
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const result = await service.saveReport('user-1', 'proj-1', {
        action: { type: 'commit', data: {} },
        passed: true,
        errorCount: 0,
        warningCount: 1,
        infoCount: 2,
        totalDuration: 100,
        canAutoFix: false,
        suggestions: [],
      } as any)

      expect(result).toEqual({ id: 'report-1' })
    })
  })

  describe('getReports', () => {
    it('applies userId/projectId/passed/limit filters', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([{ id: 'rep-1' }]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const result = await service.getReports({
        userId: 'user-1',
        projectId: 'proj-1',
        passed: true,
        limit: 5,
      })
      expect(result).toEqual([{ id: 'rep-1' }])
    })
  })

  describe('getConfig', () => {
    it('returns the config row when found', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([{ id: 'cfg-1' }]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      expect(await service.getConfig('proj-1', 'user-1')).toEqual({ id: 'cfg-1' })
    })

    it('returns null when not found', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      expect(await service.getConfig('proj-1', 'user-1')).toBeNull()
    })
  })

  describe('saveConfig', () => {
    it('upserts the config and returns the saved row', async () => {
      dbMock.insert.mockReturnValue(insertChain({ row: { id: 'cfg-1' } }))
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const result = await service.saveConfig('proj-1', 'user-1', {
        ruleSets: ['set-1'],
        ruleConfigs: {},
        settings: {},
      } as any)

      expect(result).toEqual({ id: 'cfg-1' })
    })
  })

  describe('getViolationStats', () => {
    it('summarizes fixed/autoFixed/manualFixed/ignored/pending counts', async () => {
      dbMock.select.mockReturnValue({
        from: () =>
          thenableQuery([
            { fixed: true, fix_method: 'auto' },
            { fixed: true, fix_method: 'manual' },
            { fixed: true, fix_method: 'ignored' },
            { fixed: false, fix_method: null },
            { fixed: false, fix_method: null },
          ]),
      })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const stats = await service.getViolationStats({ userId: 'user-1' })

      expect(stats).toEqual({
        total: 5,
        fixed: 3,
        autoFixed: 1,
        manualFixed: 1,
        ignored: 1,
        pending: 2,
      })
    })

    it('returns all-zero stats for an empty violation set', async () => {
      dbMock.select.mockReturnValue({ from: () => thenableQuery([]) })
      const { RuleEnforcementDbService } = await import('@/lib/services/rule-enforcement-db.service')
      const service = new RuleEnforcementDbService()

      const stats = await service.getViolationStats({})
      expect(stats).toEqual({ total: 0, fixed: 0, autoFixed: 0, manualFixed: 0, ignored: 0, pending: 0 })
    })
  })
})

describe('getRuleEnforcementDbService', () => {
  it('returns a singleton instance across calls', async () => {
    const { getRuleEnforcementDbService, RuleEnforcementDbService } = await import(
      '@/lib/services/rule-enforcement-db.service'
    )

    const a = getRuleEnforcementDbService()
    const b = getRuleEnforcementDbService()

    expect(a).toBe(b)
    expect(a).toBeInstanceOf(RuleEnforcementDbService)
  })
})
