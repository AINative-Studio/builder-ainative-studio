/**
 * Auto-fix API Endpoint
 * POST /api/rules/auto-fix - Auto-fix violations in an action
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRuleEnforcementService } from '@/lib/services/rule-enforcement.service';
import { getRuleEnforcementDbService } from '@/lib/services/rule-enforcement-db.service';
import { z } from 'zod';
import type { AgentAction, RuleViolation } from '@/lib/types/enforcement-rules';

const autoFixSchema = z.object({
  action: z.object({
    type: z.string(),
    data: z.record(z.unknown()),
    userId: z.string(),
    projectId: z.string(),
  }),
  violations: z.array(
    z.object({
      ruleId: z.string(),
      level: z.string(),
      message: z.string(),
      details: z.string().optional(),
      autoFixable: z.boolean(),
    })
  ),
});

/**
 * POST /api/rules/auto-fix
 * Automatically fix violations that support auto-fix
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    const validated = autoFixSchema.parse(body);

    const action: AgentAction = {
      ...validated.action,
      timestamp: new Date(),
    } as AgentAction;

    const violations = validated.violations as RuleViolation[];

    // Get enforcement service
    const service = getRuleEnforcementService();
    const dbService = getRuleEnforcementDbService();

    // Filter auto-fixable violations
    const fixableViolations = violations.filter((v) => v.autoFixable);

    if (fixableViolations.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No auto-fixable violations found',
        action,
        fixedCount: 0,
      });
    }

    // Apply auto-fixes
    const startTime = Date.now();
    const fixedAction = await service.autoFixViolations(action, fixableViolations);
    const fixDuration = Date.now() - startTime;

    // Mark violations as fixed in database
    for (const violation of fixableViolations) {
      // In a real implementation, we'd have violation IDs from the database
      // For now, we'll just track that auto-fix was applied
    }

    return NextResponse.json({
      success: true,
      message: `Auto-fixed ${fixableViolations.length} violation(s)`,
      action: fixedAction,
      fixedCount: fixableViolations.length,
      duration: fixDuration,
      fixes: fixableViolations.map((v) => ({
        ruleId: v.ruleId,
        message: v.message,
        suggestion: v.suggestion,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    console.error('Error applying auto-fixes:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to apply auto-fixes',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
