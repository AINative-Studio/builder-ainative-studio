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
    data: z.record(z.string(), z.unknown()),
    userId: z.string(),
    projectId: z.string(),
  }),
  violations: z.array(
    z.object({
      // The persisted rule_violations.id, as returned by
      // POST /api/rules/validate. Optional because a caller may auto-fix a
      // violation it computed itself and never persisted — in that case
      // there is nothing to mark, and the response says so rather than
      // implying a database update happened.
      violationId: z.string().optional(),
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

    // Mark the fixed violations in the database (#1193).
    //
    // This loop used to have an empty body with a comment saying "in a real
    // implementation, we'd have violation IDs from the database" — so
    // markViolationFixed() was never called and every auto-fixed violation
    // stayed `pending` forever, permanently skewing /api/rules/stats'
    // autoFixed/fixed/pending counts. The ids were always available:
    // recordViolation() `.returning()`s the inserted row, but
    // /api/rules/validate discarded it. That route now returns each
    // violation's real `violationId`, which callers pass back here.
    //
    // Marking is best-effort and never fails the request: the valuable
    // output is `fixedAction` (the actual corrected action), and losing it
    // because a bookkeeping write failed would be a worse outcome. The
    // response reports the true marking result instead of assuming success.
    let markedFixedCount = 0;
    for (const violation of fixableViolations) {
      const violationId = (violation as { violationId?: string }).violationId;
      if (!violationId) continue;

      try {
        await dbService.markViolationFixed(violationId, 'auto', fixDuration);
        markedFixedCount++;
      } catch (error) {
        console.error(
          `Failed to mark violation ${violationId} as auto-fixed:`,
          error
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: `Auto-fixed ${fixableViolations.length} violation(s)`,
      action: fixedAction,
      fixedCount: fixableViolations.length,
      // How many of those were actually recorded as fixed in the database.
      // `unmarkedCount > 0` means the code fix applied but the violation
      // history still shows them pending (no id supplied, or the write
      // failed) — surfaced rather than hidden.
      markedFixedCount,
      unmarkedCount: fixableViolations.length - markedFixedCount,
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
          details: error.issues,
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
