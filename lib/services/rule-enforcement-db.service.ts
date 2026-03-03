/**
 * Rule Enforcement Database Service
 *
 * Handles database operations for the rule enforcement framework
 */

import { db } from '@/lib/db/drizzle';
import {
  enforcement_rules,
  rule_sets,
  rule_violations,
  enforcement_reports,
  enforcement_configs,
} from '@/lib/db/schema';
import type {
  EnforcementRule as TypeEnforcementRule,
  RuleSet as TypeRuleSet,
  RuleViolation as TypeRuleViolation,
  EnforcementReport as TypeEnforcementReport,
  EnforcementConfig as TypeEnforcementConfig,
  AgentAction,
} from '@/lib/types/enforcement-rules';
import { eq, and, desc } from 'drizzle-orm';
import { getAllBuiltInRules } from './built-in-rules';

export class RuleEnforcementDbService {
  /**
   * Initialize built-in rules in database
   */
  async initializeBuiltInRules(): Promise<void> {
    const builtInRules = getAllBuiltInRules();

    // Create or get the built-in rule set
    const [ruleSet] = await db
      .insert(rule_sets)
      .values({
        name: 'AINative Built-in Rules',
        description: 'Core enforcement rules based on .ainative/RULES.MD zero-tolerance patterns',
        is_built_in: true,
        version: '1.0.0',
      })
      .onConflictDoNothing()
      .returning();

    // Insert or update each built-in rule
    for (const rule of builtInRules) {
      await db
        .insert(enforcement_rules)
        .values({
          id: rule.id,
          name: rule.name,
          description: rule.description,
          level: rule.level,
          category: rule.category,
          contexts: rule.contexts,
          enabled: rule.enabled,
          tags: rule.tags,
          rule_set_id: ruleSet?.id,
          docs_url: rule.docsUrl,
          examples: rule.examples,
        })
        .onConflictDoUpdate({
          target: enforcement_rules.id,
          set: {
            name: rule.name,
            description: rule.description,
            level: rule.level,
            category: rule.category,
            contexts: rule.contexts,
            enabled: rule.enabled,
            tags: rule.tags,
            docs_url: rule.docsUrl,
            examples: rule.examples,
            updated_at: new Date(),
          },
        });
    }
  }

  /**
   * Get all enforcement rules
   */
  async getRules(filters?: {
    category?: string;
    enabled?: boolean;
    level?: string;
  }): Promise<any[]> {
    let query = db.select().from(enforcement_rules);

    if (filters?.category) {
      query = query.where(eq(enforcement_rules.category, filters.category)) as any;
    }
    if (filters?.enabled !== undefined) {
      query = query.where(eq(enforcement_rules.enabled, filters.enabled)) as any;
    }
    if (filters?.level) {
      query = query.where(eq(enforcement_rules.level, filters.level)) as any;
    }

    return query;
  }

  /**
   * Get a specific rule by ID
   */
  async getRule(ruleId: string): Promise<any | null> {
    const [rule] = await db
      .select()
      .from(enforcement_rules)
      .where(eq(enforcement_rules.id, ruleId))
      .limit(1);

    return rule || null;
  }

  /**
   * Create or update a rule
   */
  async upsertRule(rule: Partial<TypeEnforcementRule>): Promise<any> {
    if (!rule.id) {
      throw new Error('Rule ID is required');
    }

    const [upserted] = await db
      .insert(enforcement_rules)
      .values({
        id: rule.id,
        name: rule.name!,
        description: rule.description!,
        level: rule.level || 'warning',
        category: rule.category!,
        contexts: rule.contexts || [],
        enabled: rule.enabled ?? true,
        tags: rule.tags || [],
        docs_url: rule.docsUrl,
        examples: rule.examples,
      })
      .onConflictDoUpdate({
        target: enforcement_rules.id,
        set: {
          name: rule.name!,
          description: rule.description!,
          level: rule.level || 'warning',
          category: rule.category!,
          contexts: rule.contexts || [],
          enabled: rule.enabled ?? true,
          tags: rule.tags || [],
          docs_url: rule.docsUrl,
          examples: rule.examples,
          updated_at: new Date(),
        },
      })
      .returning();

    return upserted;
  }

  /**
   * Delete a rule
   */
  async deleteRule(ruleId: string): Promise<void> {
    await db
      .delete(enforcement_rules)
      .where(eq(enforcement_rules.id, ruleId));
  }

  /**
   * Record a violation
   */
  async recordViolation(
    ruleId: string,
    userId: string,
    action: AgentAction,
    violation: TypeRuleViolation
  ): Promise<any> {
    const [recorded] = await db
      .insert(rule_violations)
      .values({
        rule_id: ruleId,
        user_id: userId,
        project_id: action.projectId,
        action_type: action.type,
        action_data: {
          commitMessage: action.data.commitMessage,
          branch: action.data.branch,
          files: action.data.files,
          filePath: action.data.filePath,
          fileContent: action.data.fileContent,
          prTitle: action.data.prTitle,
          prDescription: action.data.prDescription,
          metadata: action.data.metadata,
        },
        violation_message: violation.message,
        violation_details: violation.details,
        location: violation.location,
        suggestion: violation.suggestion,
        auto_fixable: violation.autoFixable,
      })
      .returning();

    return recorded;
  }

  /**
   * Mark a violation as fixed
   */
  async markViolationFixed(
    violationId: string,
    fixMethod: 'auto' | 'manual' | 'ignored',
    timeToFixMs?: number
  ): Promise<void> {
    await db
      .update(rule_violations)
      .set({
        fixed: true,
        fix_method: fixMethod,
        time_to_fix_ms: timeToFixMs,
        fixed_at: new Date(),
      })
      .where(eq(rule_violations.id, violationId));
  }

  /**
   * Get violations for a user/project
   */
  async getViolations(filters: {
    userId?: string;
    projectId?: string;
    ruleId?: string;
    fixed?: boolean;
    limit?: number;
  }): Promise<any[]> {
    let query = db
      .select()
      .from(rule_violations)
      .orderBy(desc(rule_violations.created_at));

    if (filters.userId) {
      query = query.where(eq(rule_violations.user_id, filters.userId)) as any;
    }
    if (filters.projectId) {
      query = query.where(eq(rule_violations.project_id, filters.projectId)) as any;
    }
    if (filters.ruleId) {
      query = query.where(eq(rule_violations.rule_id, filters.ruleId)) as any;
    }
    if (filters.fixed !== undefined) {
      query = query.where(eq(rule_violations.fixed, filters.fixed)) as any;
    }
    if (filters.limit) {
      query = query.limit(filters.limit) as any;
    }

    return query;
  }

  /**
   * Save an enforcement report
   */
  async saveReport(
    userId: string,
    projectId: string,
    report: TypeEnforcementReport
  ): Promise<any> {
    const [saved] = await db
      .insert(enforcement_reports)
      .values({
        user_id: userId,
        project_id: projectId,
        action_type: report.action.type,
        action_data: report.action.data,
        passed: report.passed,
        error_count: report.errorCount,
        warning_count: report.warningCount,
        info_count: report.infoCount,
        total_duration_ms: report.totalDuration,
        can_auto_fix: report.canAutoFix,
        suggestions: report.suggestions,
      })
      .returning();

    return saved;
  }

  /**
   * Get enforcement reports
   */
  async getReports(filters: {
    userId?: string;
    projectId?: string;
    passed?: boolean;
    limit?: number;
  }): Promise<any[]> {
    let query = db
      .select()
      .from(enforcement_reports)
      .orderBy(desc(enforcement_reports.created_at));

    if (filters.userId) {
      query = query.where(eq(enforcement_reports.user_id, filters.userId)) as any;
    }
    if (filters.projectId) {
      query = query.where(eq(enforcement_reports.project_id, filters.projectId)) as any;
    }
    if (filters.passed !== undefined) {
      query = query.where(eq(enforcement_reports.passed, filters.passed)) as any;
    }
    if (filters.limit) {
      query = query.limit(filters.limit) as any;
    }

    return query;
  }

  /**
   * Get or create enforcement config for a project
   */
  async getConfig(projectId: string, userId: string): Promise<any | null> {
    const [config] = await db
      .select()
      .from(enforcement_configs)
      .where(
        and(
          eq(enforcement_configs.project_id, projectId),
          eq(enforcement_configs.user_id, userId)
        )
      )
      .limit(1);

    return config || null;
  }

  /**
   * Save enforcement config
   */
  async saveConfig(
    projectId: string,
    userId: string,
    config: TypeEnforcementConfig
  ): Promise<any> {
    const [saved] = await db
      .insert(enforcement_configs)
      .values({
        project_id: projectId,
        user_id: userId,
        rule_set_ids: config.ruleSets,
        rule_configs: config.ruleConfigs,
        settings: config.settings,
      })
      .onConflictDoUpdate({
        target: [enforcement_configs.project_id, enforcement_configs.user_id],
        set: {
          rule_set_ids: config.ruleSets,
          rule_configs: config.ruleConfigs,
          settings: config.settings,
          updated_at: new Date(),
        },
      })
      .returning();

    return saved;
  }

  /**
   * Get violation statistics
   */
  async getViolationStats(filters: {
    userId?: string;
    projectId?: string;
    ruleId?: string;
  }): Promise<{
    total: number;
    fixed: number;
    autoFixed: number;
    manualFixed: number;
    ignored: number;
    pending: number;
  }> {
    let query = db.select().from(rule_violations);

    if (filters.userId) {
      query = query.where(eq(rule_violations.user_id, filters.userId)) as any;
    }
    if (filters.projectId) {
      query = query.where(eq(rule_violations.project_id, filters.projectId)) as any;
    }
    if (filters.ruleId) {
      query = query.where(eq(rule_violations.rule_id, filters.ruleId)) as any;
    }

    const violations = await query;

    return {
      total: violations.length,
      fixed: violations.filter((v) => v.fixed).length,
      autoFixed: violations.filter((v) => v.fix_method === 'auto').length,
      manualFixed: violations.filter((v) => v.fix_method === 'manual').length,
      ignored: violations.filter((v) => v.fix_method === 'ignored').length,
      pending: violations.filter((v) => !v.fixed).length,
    };
  }
}

// Singleton instance
let dbServiceInstance: RuleEnforcementDbService | null = null;

export function getRuleEnforcementDbService(): RuleEnforcementDbService {
  if (!dbServiceInstance) {
    dbServiceInstance = new RuleEnforcementDbService();
  }
  return dbServiceInstance;
}
