/**
 * Unit tests for RuleEnforcementService.
 *
 * These mirror the acceptance-criteria Test Plan in issue #18 and additionally
 * cover report aggregation, strict mode, and the deterministic auto-fix flow.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEnforcementService } from '@/lib/services/rule-enforcement.service';
import { RULE_IDS } from '@/lib/types/enforcement-rules';
import type {
  AgentAction,
  EnforcementConfig,
  RuleContext,
} from '@/lib/types/enforcement-rules';

function makeAction(
  type: RuleContext,
  data: AgentAction['data']
): AgentAction {
  return {
    type,
    data,
    userId: 'user-1',
    projectId: 'project-1',
    timestamp: new Date(),
  };
}

function baseConfig(
  overrides?: Partial<EnforcementConfig['settings']>
): EnforcementConfig {
  return {
    projectId: 'project-1',
    ruleSets: [],
    ruleConfigs: [],
    settings: {
      autoFix: false,
      strictMode: false,
      continueOnError: true,
      ...overrides,
    },
  };
}

describe('RuleEnforcementService', () => {
  let service: RuleEnforcementService;

  beforeEach(async () => {
    service = new RuleEnforcementService();
    await service.initialize(baseConfig());
  });

  it('loads built-in rules on initialize', () => {
    expect(service.getRules().length).toBeGreaterThanOrEqual(10);
    expect(service.getRule(RULE_IDS.NO_AI_ATTRIBUTION)).toBeDefined();
  });

  it('blocks third-party AI attribution', async () => {
    const action = makeAction('commit', {
      commitMessage: 'Add feature\n\nGenerated with Claude',
    });
    const report = await service.validateAction(action);
    expect(report.passed).toBe(false);
    const violations = report.results.flatMap((r) => r.violations);
    expect(violations).toContainEqual(
      expect.objectContaining({
        ruleId: RULE_IDS.NO_AI_ATTRIBUTION,
        level: 'error',
      })
    );
  });

  it('auto-fixes attribution violations', async () => {
    const action = makeAction('commit', {
      commitMessage: 'Add feature\n\nCo-Authored-By: Claude',
    });
    const report = await service.validateAction(action);
    const violations = report.results.flatMap((r) => r.violations);
    const fixed = await service.autoFixViolations(action, violations);
    expect(fixed.data.commitMessage).not.toContain('Claude');
  });

  it('prevents root .md file creation with a docs/ suggestion', async () => {
    const action = makeAction('file-create', { filePath: 'SUMMARY.md' });
    const report = await service.validateAction(action);
    expect(report.passed).toBe(false);
    const violations = report.results.flatMap((r) => r.violations);
    const rootMd = violations.find(
      (v) => v.ruleId === RULE_IDS.NO_ROOT_MD_FILES
    );
    expect(rootMd?.suggestion).toContain('docs/');
  });

  it('detects secrets in code', async () => {
    // Build the secret fixture at runtime so no scannable literal ships in
    // source (satisfies push-protection) while still matching the rule regex
    // /sk_live_[a-zA-Z0-9]{24,}/.
    const fakeStripeKey = ['sk', 'live', 'x'.repeat(28)].join('_');
    const action = makeAction('file-edit', {
      filePath: 'lib/pay.ts',
      fileContent: `const API_KEY = "${fakeStripeKey}"`,
    });
    const report = await service.validateAction(action);
    expect(report.errorCount).toBeGreaterThan(0);
  });

  it('passes a clean, conventional, tested commit', async () => {
    const action = makeAction('commit', {
      commitMessage: 'feat(auth): add login',
      files: ['app/login.ts'],
      testOutput: 'All tests passed. 92% coverage',
    });
    const report = await service.validateAction(action);
    expect(report.passed).toBe(true);
    expect(report.errorCount).toBe(0);
  });

  describe('report aggregation', () => {
    it('counts errors, warnings and info separately', async () => {
      // "Added stuff" -> non-conventional (warning), no test output +
      // code files (error). Attribution clean.
      const action = makeAction('commit', {
        commitMessage: 'Added stuff',
        files: ['app/x.ts'],
      });
      const report = await service.validateAction(action);
      expect(report.errorCount).toBeGreaterThanOrEqual(1); // mandatory tests
      expect(report.warningCount).toBeGreaterThanOrEqual(1); // commit format
    });

    it('reports canAutoFix=true when an auto-fixable violation exists', async () => {
      const action = makeAction('commit', {
        commitMessage: 'feat(x): thing\n\nGenerated with Claude',
        files: ['app/x.ts'],
        testOutput: '90% coverage',
      });
      const report = await service.validateAction(action);
      expect(report.canAutoFix).toBe(true);
    });

    it('dedupes suggestions', async () => {
      const action = makeAction('commit', {
        commitMessage: 'feat(x): thing',
        files: ['app/x.ts'],
      });
      const report = await service.validateAction(action);
      expect(new Set(report.suggestions).size).toBe(report.suggestions.length);
    });

    it('meets the <500ms full-validation performance target', async () => {
      const action = makeAction('commit', {
        commitMessage: 'feat(x): thing',
        files: ['app/x.ts'],
        testOutput: '90% coverage',
      });
      const report = await service.validateAction(action);
      expect(report.totalDuration).toBeLessThan(500);
    });
  });

  describe('strict mode', () => {
    it('fails on warnings when strictMode is enabled', async () => {
      const strict = new RuleEnforcementService();
      await strict.initialize(baseConfig({ strictMode: true }));
      const action = makeAction('commit', {
        // Non-conventional format => warning only, no error.
        commitMessage: 'Added stuff',
        files: ['app/x.ts'],
        testOutput: '90% coverage',
      });
      const report = await strict.validateAction(action);
      expect(report.warningCount).toBeGreaterThan(0);
      expect(report.passed).toBe(false);
    });

    it('passes warnings when strictMode is disabled', async () => {
      const action = makeAction('commit', {
        commitMessage: 'Added stuff',
        files: ['app/x.ts'],
        testOutput: '90% coverage',
      });
      const report = await service.validateAction(action);
      // no errors, only warnings -> passes in non-strict mode
      expect(report.errorCount).toBe(0);
      expect(report.passed).toBe(true);
    });
  });

  describe('autoFixViolations', () => {
    it('works without prior initialize() (lazy-loads built-in rules)', async () => {
      const fresh = new RuleEnforcementService();
      const action = makeAction('commit', {
        commitMessage: 'feat: x\n\nGenerated with Claude',
      });
      const fixed = await fresh.autoFixViolations(action, [
        {
          ruleId: RULE_IDS.NO_AI_ATTRIBUTION,
          level: 'error',
          message: 'attribution',
          autoFixable: true,
        },
      ]);
      expect(fixed.data.commitMessage).not.toContain('Claude');
    });

    it('does not mutate the input action', async () => {
      const original = 'feat: x\n\nCo-Authored-By: Claude';
      const action = makeAction('commit', { commitMessage: original });
      await service.autoFixViolations(action, [
        {
          ruleId: RULE_IDS.NO_AI_ATTRIBUTION,
          level: 'error',
          message: 'attribution',
          autoFixable: true,
        },
      ]);
      expect(action.data.commitMessage).toBe(original);
    });

    it('fixes reconstructed violations that carry no closure', async () => {
      const action = makeAction('file-edit', {
        filePath: 'lib/x.ts',
        fileContent: 'console.log("debug")',
      });
      // Violation shaped like one deserialized from an HTTP request body.
      const fixed = await service.autoFixViolations(action, [
        {
          ruleId: RULE_IDS.NO_CONSOLE_LOG,
          level: 'warning',
          message: 'console.log',
          autoFixable: true,
        },
      ]);
      expect(fixed.data.fileContent).toContain('logger.info(');
    });

    it('ignores non-auto-fixable violations', async () => {
      const action = makeAction('commit', { commitMessage: 'feat: x' });
      const fixed = await service.autoFixViolations(action, [
        {
          ruleId: RULE_IDS.MANDATORY_TEST_EXECUTION,
          level: 'error',
          message: 'no tests',
          autoFixable: false,
        },
      ]);
      expect(fixed.data.commitMessage).toBe('feat: x');
    });
  });

  describe('registerRule', () => {
    it('registers and retrieves a custom rule', () => {
      service.registerRule({
        id: 'custom/no-todo',
        name: 'No TODO',
        description: 'Block TODO comments',
        level: 'warning',
        contexts: ['file-edit'],
        enabled: true,
        category: 'code-quality',
        tags: ['custom'],
        check: async (a) => ({
          ruleId: 'custom/no-todo',
          passed: !a.data.fileContent?.includes('TODO'),
          violations: a.data.fileContent?.includes('TODO')
            ? [
                {
                  ruleId: 'custom/no-todo',
                  level: 'warning',
                  message: 'TODO found',
                  autoFixable: false,
                },
              ]
            : [],
          duration: 0,
        }),
      });
      expect(service.getRule('custom/no-todo')).toBeDefined();
    });

    it('applies a registered custom rule during validation', async () => {
      service.registerRule({
        id: 'custom/no-todo',
        name: 'No TODO',
        description: 'Block TODO comments',
        level: 'error',
        contexts: ['file-edit'],
        enabled: true,
        category: 'code-quality',
        tags: ['custom'],
        check: async (a) => {
          const bad = a.data.fileContent?.includes('TODO');
          return {
            ruleId: 'custom/no-todo',
            passed: !bad,
            violations: bad
              ? [
                  {
                    ruleId: 'custom/no-todo',
                    level: 'error',
                    message: 'TODO found',
                    autoFixable: false,
                  },
                ]
              : [],
            duration: 0,
          };
        },
      });
      const report = await service.validateAction(
        makeAction('file-edit', {
          filePath: 'lib/x.ts',
          fileContent: '// TODO: fix later',
        })
      );
      expect(report.passed).toBe(false);
    });

    it('skips disabled rules', async () => {
      service.registerRule({
        id: 'custom/disabled',
        name: 'Disabled',
        description: 'never runs',
        level: 'error',
        contexts: ['file-edit'],
        enabled: false,
        category: 'code-quality',
        tags: [],
        check: async () => ({
          ruleId: 'custom/disabled',
          passed: false,
          violations: [
            {
              ruleId: 'custom/disabled',
              level: 'error',
              message: 'should not appear',
              autoFixable: false,
            },
          ],
          duration: 0,
        }),
      });
      const report = await service.validateAction(
        makeAction('file-edit', { filePath: 'lib/x.ts', fileContent: 'ok' })
      );
      const ids = report.results.map((r) => r.ruleId);
      expect(ids).not.toContain('custom/disabled');
    });
  });

  describe('error handling', () => {
    it('captures a thrown error from a rule check as an error violation', async () => {
      service.registerRule({
        id: 'custom/throws',
        name: 'Throws',
        description: 'always throws',
        level: 'error',
        contexts: ['file-edit'],
        enabled: true,
        category: 'code-quality',
        tags: [],
        check: async () => {
          throw new Error('boom');
        },
      });
      const report = await service.validateAction(
        makeAction('file-edit', { filePath: 'lib/x.ts', fileContent: 'ok' })
      );
      const violations = report.results.flatMap((r) => r.violations);
      expect(
        violations.some((v) => v.message.includes('boom'))
      ).toBe(true);
    });
  });
});
