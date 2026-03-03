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
   * Auto-fix all fixable violations
   */
  async autoFixViolations(
    action: AgentAction,
    violations: RuleViolation[]
  ): Promise<AgentAction> {
    let fixedAction = { ...action };

    for (const violation of violations) {
      if (violation.autoFixable && violation.autoFix) {
        await violation.autoFix();
        // TODO: Track that this violation was auto-fixed
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

  private async loadRuleSet(ruleSetId: string): Promise<void> {
    // TODO: Fetch rule set from database
    console.log(`Loading rule set: ${ruleSetId}`);
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
