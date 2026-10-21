/**
 * Rule Enforcement Service
 *
 * Implements pre-flight validation for agent actions based on configured rules.
 * Inspired by .ainative zero-tolerance enforcement patterns.
 */

import {
  AgentAction,
  EnforcementRule,
  RuleCheckResult,
  EnforcementReport,
  RuleViolation,
  EnforcementConfig,
  RuleSet,
  RULE_IDS,
} from '@/lib/types/enforcement-rules';

export class RuleEnforcementService {
  private rules: Map<string, EnforcementRule> = new Map();
  private config: EnforcementConfig | null = null;

  /**
   * Initialize with configuration
   */
  async initialize(config: EnforcementConfig): Promise<void> {
    this.config = config;

    // Load built-in rules
    await this.loadBuiltInRules();

    // Load custom rule sets
    for (const ruleSetId of config.ruleSets) {
      await this.loadRuleSet(ruleSetId);
    }
  }

  /**
   * Validate an action against all applicable rules
   */
  async validateAction(action: AgentAction): Promise<EnforcementReport> {
    const startTime = Date.now();
    const results: RuleCheckResult[] = [];

    // Get applicable rules for this action type
    const applicableRules = this.getApplicableRules(action.type);

    // Run all checks in parallel
    const checkPromises = applicableRules.map((rule) =>
      this.runRuleCheck(rule, action)
    );

    const checkResults = await Promise.all(checkPromises);
    results.push(...checkResults);

    // Generate report
    const report = this.generateReport(action, results, Date.now() - startTime);

    return report;
  }

  /**
   * Auto-fix all fixable violations.
   *
   * Returns a NEW action with fixes applied. The input action is never mutated.
   *
   * Fixes are applied deterministically by looking up the registered rule for
   * each violation and invoking its rule-level `autoFix(action)`. This works
   * for reconstructed violations coming over HTTP (which have no live closures),
   * unlike relying on the per-violation `autoFix()` closure.
   */
  async autoFixViolations(
    action: AgentAction,
    violations: RuleViolation[]
  ): Promise<AgentAction> {
    // Ensure built-in rules are available even if initialize() was skipped.
    if (this.rules.size === 0) {
      await this.loadBuiltInRules();
    }

    // Deep-copy so callers' input is never mutated.
    let fixedAction: AgentAction = {
      ...action,
      data: { ...action.data },
    };

    // De-duplicate by ruleId — one autoFix pass per rule is sufficient.
    const ruleIds = new Set<string>();
    for (const violation of violations) {
      if (violation.autoFixable) {
        ruleIds.add(violation.ruleId);
      }
    }

    for (const ruleId of ruleIds) {
      const rule = this.rules.get(ruleId);
      if (rule?.autoFix) {
        fixedAction = await rule.autoFix(fixedAction);
      } else {
        // Fall back to a live per-violation closure if a rule-level fixer
        // is unavailable (e.g. custom in-memory violations).
        const violation = violations.find(
          (v) => v.ruleId === ruleId && v.autoFix
        );
        if (violation?.autoFix) {
          await violation.autoFix();
        }
      }
    }

    return fixedAction;
  }

  /**
   * Register a custom rule
   */
  registerRule(rule: EnforcementRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Get all registered rules
   */
  getRules(): EnforcementRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get a specific rule
   */
  getRule(ruleId: string): EnforcementRule | undefined {
    return this.rules.get(ruleId);
  }

  // Private methods

  private async loadBuiltInRules(): Promise<void> {
    // Import and register all built-in rules
    const { getAllBuiltInRules } = await import('./built-in-rules');
    const builtInRules = getAllBuiltInRules();

    for (const rule of builtInRules) {
      this.registerRule(rule);
    }
  }

  /**
   * #1193 — this was a bare `console.log` stub with a `// TODO: Fetch rule
   * set from database` comment: it accepted ANY ruleSetId and silently
   * succeeded whether or not a real rule set by that id actually existed,
   * since there is no database-backed custom rule set storage anywhere in
   * this codebase today (confirmed: RuleSet's own `isBuiltIn` field implies
   * a non-built-in, DB-fetched set was designed for, but no table/ZeroDB
   * schema/fetch path for one was ever built). That silent-success shape is
   * exactly the deceptive-stub pattern the issue is about — a caller asking
   * for a real custom rule set got no error and no rules, with no signal
   * anything was wrong.
   *
   * The only real caller (app/api/rules/validate/route.ts) only ever passes
   * 'built-in' — already loaded unconditionally by loadBuiltInRules() above,
   * so re-"loading" it here is correctly a no-op, not a gap. Any OTHER
   * ruleSetId has nowhere real to come from yet, so it throws loudly instead
   * of pretending to succeed — a future caller that actually needs custom
   * rule sets gets a clear signal to build real storage, not a silent no-op.
   */
  private async loadRuleSet(ruleSetId: string): Promise<void> {
    if (ruleSetId === 'built-in') return; // already loaded by loadBuiltInRules() above
    throw new Error(
      `Unknown rule set "${ruleSetId}" — no database-backed custom rule set storage exists yet. ` +
      `Only 'built-in' is currently supported.`,
    );
  }

  private getApplicableRules(context: string): EnforcementRule[] {
    return Array.from(this.rules.values()).filter(
      (rule) => rule.enabled && rule.contexts.includes(context as any)
    );
  }

  private async runRuleCheck(
    rule: EnforcementRule,
    action: AgentAction
  ): Promise<RuleCheckResult> {
    try {
      return await rule.check(action);
    } catch (error) {
      // Rule check failed
      return {
        ruleId: rule.id,
        passed: false,
        violations: [
          {
            ruleId: rule.id,
            level: 'error',
            message: `Rule check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            autoFixable: false,
          },
        ],
        duration: 0,
      };
    }
  }

  private generateReport(
    action: AgentAction,
    results: RuleCheckResult[],
    totalDuration: number
  ): EnforcementReport {
    const allViolations = results.flatMap((r) => r.violations);

    const errorCount = allViolations.filter((v) => v.level === 'error').length;
    const warningCount = allViolations.filter(
      (v) => v.level === 'warning'
    ).length;
    const infoCount = allViolations.filter((v) => v.level === 'info').length;

    const passed = errorCount === 0 && (this.config?.settings.strictMode ? warningCount === 0 : true);

    const canAutoFix = allViolations.length > 0 && allViolations.some((v) => v.autoFixable);

    const suggestions = [
      ...new Set(
        allViolations.map((v) => v.suggestion).filter(Boolean) as string[]
      ),
    ];

    return {
      action,
      results,
      passed,
      errorCount,
      warningCount,
      infoCount,
      totalDuration,
      timestamp: new Date(),
      canAutoFix,
      suggestions,
    };
  }
}

// Singleton instance
let enforcementServiceInstance: RuleEnforcementService | null = null;

export function getRuleEnforcementService(): RuleEnforcementService {
  if (!enforcementServiceInstance) {
    enforcementServiceInstance = new RuleEnforcementService();
  }
  return enforcementServiceInstance;
}
