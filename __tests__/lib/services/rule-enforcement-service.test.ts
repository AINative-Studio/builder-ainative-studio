import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  AgentAction,
  EnforcementConfig,
  EnforcementRule,
  RuleCheckResult,
  RuleContext,
  RuleViolation,
} from '@/lib/types/enforcement-rules'

/**
 * Unit tests for lib/services/rule-enforcement.service.ts (issue #1201 /
 * coverage phase 1). `__tests__/services/rule-enforcement.service.test.ts`
 * already exercises most of this file against the REAL built-in rules
 * (it hits ~91% statements). These tests are deliberately different: they
 * mock `./built-in-rules` at the boundary so we fully control which rules
 * exist, letting us drive two paths the real-rule suite can't reach
 * deterministically:
 *
 *   1. the `getRuleEnforcementService()` module-level singleton getter
 *      (never called from the other test file, since it constructs its
 *      own `RuleEnforcementService` instances directly)
 *   2. the `autoFixViolations` fallback branch that runs a live
 *      per-violation `autoFix()` closure when the *rule* registered for
 *      that violation has no rule-level `autoFix` of its own
 *
 * No real I/O is involved — `built-in-rules` just exports an array of
 * plain objects/functions — but mocking it is what gives us a hermetic,
 * fully-controlled rule set instead of depending on the production rule
 * list's exact shape.
 */

const builtInRulesMock = vi.hoisted(() => ({
  getAllBuiltInRules: vi.fn(),
}))
vi.mock('@/lib/services/built-in-rules', () => builtInRulesMock)

function makeAction(
  type: RuleContext = 'commit',
  data: AgentAction['data'] = {}
): AgentAction {
  return {
    type,
    data,
    userId: 'user-1',
    projectId: 'project-1',
    timestamp: new Date(),
  }
}

function baseConfig(overrides?: Partial<EnforcementConfig>): EnforcementConfig {
  return {
    projectId: 'project-1',
    ruleSets: ['built-in'],
    ruleConfigs: [],
    settings: {
      autoFix: false,
      strictMode: false,
      continueOnError: true,
    },
    ...overrides,
  } as EnforcementConfig
}

function makeRule(overrides: Partial<EnforcementRule> = {}): EnforcementRule {
  const id = overrides.id ?? 'test-rule'
  return {
    id,
    name: 'Test Rule',
    description: 'A rule used for testing',
    level: 'error',
    contexts: ['commit'],
    enabled: true,
    category: 'code-quality',
    tags: [],
    check: vi.fn(async (): Promise<RuleCheckResult> => ({
      ruleId: id,
      passed: true,
      violations: [],
      duration: 0,
    })),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  builtInRulesMock.getAllBuiltInRules.mockReturnValue([])
})

describe('getRuleEnforcementService (module singleton)', () => {
  it('returns the same instance across repeated calls, so callers share one rule registry', async () => {
    const { getRuleEnforcementService, RuleEnforcementService } = await import(
      '@/lib/services/rule-enforcement.service'
    )

    const first = getRuleEnforcementService()
    const second = getRuleEnforcementService()

    expect(first).toBeInstanceOf(RuleEnforcementService)
    expect(second).toBe(first)
  })
})

describe('RuleEnforcementService.initialize', () => {
  it('loads built-in rules and registers each one', async () => {
    const rule = makeRule({ id: 'builtin-1' })
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([rule])

    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()

    await service.initialize(baseConfig())

    expect(service.getRule('builtin-1')).toBe(rule)
    expect(builtInRulesMock.getAllBuiltInRules).toHaveBeenCalledTimes(1)
  })

  it('treats "built-in" in ruleSets as already-loaded (no-op), not an error', async () => {
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()

    await expect(service.initialize(baseConfig({ ruleSets: ['built-in'] }))).resolves.toBeUndefined()
  })

  it('throws loudly for any non-built-in rule set id, since no DB-backed custom rule set storage exists (#1193)', async () => {
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()

    await expect(
      service.initialize(baseConfig({ ruleSets: ['built-in', 'some-custom-set'] }))
    ).rejects.toThrow(/Unknown rule set "some-custom-set"/)
  })
})

describe('RuleEnforcementService.validateAction', () => {
  it('only runs rules whose contexts include the action type', async () => {
    const commitRule = makeRule({ id: 'commit-rule', contexts: ['commit'] })
    const deployRule = makeRule({ id: 'deploy-rule', contexts: ['deploy'] })
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([commitRule, deployRule])

    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    await service.initialize(baseConfig())

    const report = await service.validateAction(makeAction('commit'))

    expect(commitRule.check).toHaveBeenCalledTimes(1)
    expect(deployRule.check).not.toHaveBeenCalled()
    expect(report.results).toHaveLength(1)
    expect(report.results[0].ruleId).toBe('commit-rule')
  })

  it('skips disabled rules entirely', async () => {
    const disabledRule = makeRule({ id: 'disabled-rule', enabled: false })
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([disabledRule])

    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    await service.initialize(baseConfig())

    const report = await service.validateAction(makeAction('commit'))

    expect(disabledRule.check).not.toHaveBeenCalled()
    expect(report.results).toHaveLength(0)
    expect(report.passed).toBe(true)
  })

  it('catches a rule whose check() throws and converts it into an error-level violation instead of crashing validateAction', async () => {
    const throwingRule = makeRule({
      id: 'throwing-rule',
      check: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([throwingRule])

    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    await service.initialize(baseConfig())

    const report = await service.validateAction(makeAction('commit'))

    expect(report.results).toHaveLength(1)
    expect(report.results[0].passed).toBe(false)
    expect(report.results[0].violations[0]).toMatchObject({
      ruleId: 'throwing-rule',
      level: 'error',
      message: 'Rule check failed: boom',
      autoFixable: false,
    })
    expect(report.errorCount).toBe(1)
    expect(report.passed).toBe(false)
  })

  it('converts a non-Error thrown value into "Unknown error" in the violation message', async () => {
    const throwingRule = makeRule({
      id: 'throwing-rule',
      check: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'not an Error instance'
      }),
    })
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([throwingRule])

    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    await service.initialize(baseConfig())

    const report = await service.validateAction(makeAction('commit'))

    expect(report.results[0].violations[0].message).toBe('Rule check failed: Unknown error')
  })
})

describe('RuleEnforcementService report generation (aggregation + strict mode)', () => {
  function violation(level: RuleViolation['level'], overrides: Partial<RuleViolation> = {}): RuleViolation {
    return { ruleId: 'r', level, message: 'msg', autoFixable: false, ...overrides }
  }

  async function serviceWithRules(rules: EnforcementRule[]) {
    builtInRulesMock.getAllBuiltInRules.mockReturnValue(rules)
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    await service.initialize(baseConfig())
    return service
  }

  it('passes when there are zero violations', async () => {
    const service = await serviceWithRules([makeRule({ id: 'clean' })])
    const report = await service.validateAction(makeAction())

    expect(report.passed).toBe(true)
    expect(report.errorCount).toBe(0)
    expect(report.warningCount).toBe(0)
    expect(report.infoCount).toBe(0)
    expect(report.canAutoFix).toBe(false)
  })

  it('fails (non-strict) only on error-level violations; warnings alone still pass', async () => {
    const warnRule = makeRule({
      id: 'warn-rule',
      check: vi.fn(async () => ({
        ruleId: 'warn-rule',
        passed: false,
        violations: [violation('warning')],
        duration: 1,
      })),
    })
    const service = await serviceWithRules([warnRule])

    const report = await service.validateAction(makeAction())

    expect(report.warningCount).toBe(1)
    expect(report.errorCount).toBe(0)
    expect(report.passed).toBe(true) // strictMode is false by default
  })

  it('fails on warnings too when strictMode is enabled', async () => {
    const warnRule = makeRule({
      id: 'warn-rule',
      check: vi.fn(async () => ({
        ruleId: 'warn-rule',
        passed: false,
        violations: [violation('warning')],
        duration: 1,
      })),
    })
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([warnRule])
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    await service.initialize(baseConfig({ settings: { autoFix: false, strictMode: true, continueOnError: true } }))

    const report = await service.validateAction(makeAction())

    expect(report.passed).toBe(false)
  })

  it('counts info-level violations separately and still passes', async () => {
    const infoRule = makeRule({
      id: 'info-rule',
      check: vi.fn(async () => ({
        ruleId: 'info-rule',
        passed: true,
        violations: [violation('info')],
        duration: 1,
      })),
    })
    const service = await serviceWithRules([infoRule])

    const report = await service.validateAction(makeAction())

    expect(report.infoCount).toBe(1)
    expect(report.passed).toBe(true)
  })

  it('de-duplicates identical suggestion strings across multiple violations', async () => {
    const ruleA = makeRule({
      id: 'rule-a',
      check: vi.fn(async () => ({
        ruleId: 'rule-a',
        passed: false,
        violations: [violation('warning', { suggestion: 'Fix the thing' })],
        duration: 1,
      })),
    })
    const ruleB = makeRule({
      id: 'rule-b',
      check: vi.fn(async () => ({
        ruleId: 'rule-b',
        passed: false,
        violations: [violation('warning', { suggestion: 'Fix the thing' })],
        duration: 1,
      })),
    })
    const service = await serviceWithRules([ruleA, ruleB])

    const report = await service.validateAction(makeAction())

    expect(report.suggestions).toEqual(['Fix the thing'])
  })

  it('omits falsy/undefined suggestions from the suggestions list', async () => {
    const rule = makeRule({
      id: 'no-suggestion-rule',
      check: vi.fn(async () => ({
        ruleId: 'no-suggestion-rule',
        passed: false,
        violations: [violation('warning')], // no `suggestion` field
        duration: 1,
      })),
    })
    const service = await serviceWithRules([rule])

    const report = await service.validateAction(makeAction())

    expect(report.suggestions).toEqual([])
  })

  it('reports canAutoFix true when at least one violation is autoFixable, even if others are not', async () => {
    const rule = makeRule({
      id: 'mixed-rule',
      check: vi.fn(async () => ({
        ruleId: 'mixed-rule',
        passed: false,
        violations: [
          violation('error', { autoFixable: false }),
          violation('warning', { autoFixable: true }),
        ],
        duration: 1,
      })),
    })
    const service = await serviceWithRules([rule])

    const report = await service.validateAction(makeAction())

    expect(report.canAutoFix).toBe(true)
  })

  it('includes the original action and a timestamp in the report', async () => {
    const service = await serviceWithRules([makeRule({ id: 'clean' })])
    const action = makeAction('deploy', { buildCommand: 'npm run build' })
    // deploy context: register a rule that matches it so results aren't empty
    const report = await service.validateAction(action)

    expect(report.action).toBe(action)
    expect(report.timestamp).toBeInstanceOf(Date)
    expect(typeof report.totalDuration).toBe('number')
  })
})

describe('RuleEnforcementService.autoFixViolations', () => {
  it('applies a rule-level autoFix and returns a new action object without mutating the input', async () => {
    const fixedData = { commitMessage: 'fixed message' }
    const rule = makeRule({
      id: 'fixable-rule',
      autoFix: vi.fn(async (action: AgentAction) => ({
        ...action,
        data: { ...action.data, ...fixedData },
      })),
    })
    const service = await (async () => {
      builtInRulesMock.getAllBuiltInRules.mockReturnValue([rule])
      const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
      const s = new RuleEnforcementService()
      await s.initialize(baseConfig())
      return s
    })()

    const originalAction = makeAction('commit', { commitMessage: 'bad message' })
    const violations: RuleViolation[] = [
      { ruleId: 'fixable-rule', level: 'error', message: 'bad', autoFixable: true },
    ]

    const result = await service.autoFixViolations(originalAction, violations)

    expect(rule.autoFix).toHaveBeenCalledTimes(1)
    expect(result.data.commitMessage).toBe('fixed message')
    // input action must never be mutated
    expect(originalAction.data.commitMessage).toBe('bad message')
    expect(result).not.toBe(originalAction)
  })

  it('falls back to a live per-violation autoFix() closure when no rule-level fixer is registered for that ruleId', async () => {
    // No rules registered at all for this ruleId — exercises the
    // `rule?.autoFix` falsy branch and the per-violation closure fallback
    // (lines ~100-108 of rule-enforcement.service.ts).
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([])
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    await service.initialize(baseConfig())

    const closureFix = vi.fn(async () => {})
    const violations: RuleViolation[] = [
      {
        ruleId: 'unregistered-rule',
        level: 'warning',
        message: 'needs a fix',
        autoFixable: true,
        autoFix: closureFix,
      },
    ]

    const action = makeAction()
    const result = await service.autoFixViolations(action, violations)

    expect(closureFix).toHaveBeenCalledTimes(1)
    // No rule-level fixer ran, so the returned action's data is an
    // unmodified (but distinct, deep-copied) clone of the input.
    expect(result).not.toBe(action)
    expect(result.data).toEqual(action.data)
  })

  it('does nothing (no throw, unchanged data) when a violation with no matching autoFixable entry is passed', async () => {
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([])
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    await service.initialize(baseConfig())

    const action = makeAction()
    const violations: RuleViolation[] = [
      { ruleId: 'not-fixable', level: 'info', message: 'fyi', autoFixable: false },
    ]

    const result = await service.autoFixViolations(action, violations)

    expect(result.data).toEqual(action.data)
  })

  it('de-duplicates by ruleId: a rule-level autoFix registered for two violations of the same rule only runs once', async () => {
    const rule = makeRule({
      id: 'dup-rule',
      autoFix: vi.fn(async (action: AgentAction) => action),
    })
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([rule])
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    await service.initialize(baseConfig())

    const violations: RuleViolation[] = [
      { ruleId: 'dup-rule', level: 'error', message: 'one', autoFixable: true },
      { ruleId: 'dup-rule', level: 'warning', message: 'two', autoFixable: true },
    ]

    await service.autoFixViolations(makeAction(), violations)

    expect(rule.autoFix).toHaveBeenCalledTimes(1)
  })

  it('lazily loads built-in rules when autoFixViolations is called before initialize()', async () => {
    const rule = makeRule({ id: 'lazy-rule' })
    builtInRulesMock.getAllBuiltInRules.mockReturnValue([rule])
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')

    // Fresh instance — initialize() was never called, so this.rules.size === 0.
    const service = new RuleEnforcementService()

    await service.autoFixViolations(makeAction(), [])

    expect(builtInRulesMock.getAllBuiltInRules).toHaveBeenCalledTimes(1)
    expect(service.getRule('lazy-rule')).toBe(rule)
  })
})

describe('RuleEnforcementService.registerRule / getRules / getRule', () => {
  it('registers a custom rule and makes it retrievable by id and in the full list', async () => {
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()
    const customRule = makeRule({ id: 'custom-rule' })

    service.registerRule(customRule)

    expect(service.getRule('custom-rule')).toBe(customRule)
    expect(service.getRules()).toContainEqual(customRule)
  })

  it('returns undefined for a rule id that was never registered', async () => {
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()

    expect(service.getRule('nonexistent')).toBeUndefined()
  })

  it('getRules() returns an empty array for a service with no registered rules', async () => {
    const { RuleEnforcementService } = await import('@/lib/services/rule-enforcement.service')
    const service = new RuleEnforcementService()

    expect(service.getRules()).toEqual([])
  })
})
