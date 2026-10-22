/**
 * Rule Validation API Endpoint
 * POST /api/rules/validate - Validate an action against all applicable rules
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getRuleEnforcementService } from '@/lib/services/rule-enforcement.service';
import { getRuleEnforcementDbService } from '@/lib/services/rule-enforcement-db.service';
import { z } from 'zod';
import type { AgentAction } from '@/lib/types/enforcement-rules';

const actionSchema = z.object({
  type: z.enum([
    'commit',
    'file-create',
    'file-edit',
    'file-delete',
    'pr-create',
    'branch-create',
    'test-run',
    'build',
    'deploy',
  ]),
  data: z.object({
    commitMessage: z.string().optional(),
    branch: z.string().optional(),
    files: z.array(z.string()).optional(),
    filePath: z.string().optional(),
    fileContent: z.string().optional(),
    fileType: z.string().optional(),
    prTitle: z.string().optional(),
    prDescription: z.string().optional(),
    baseBranch: z.string().optional(),
    headBranch: z.string().optional(),
    testCommand: z.string().optional(),
    testOutput: z.string().optional(),
    buildCommand: z.string().optional(),
    buildOutput: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  // projectId stays client-supplied (a free-form label, not a DB FK target).
  // userId does NOT — see the real bug this fixes below.
  projectId: z.string(),
});

/**
 * POST /api/rules/validate
 * Validate an action against all applicable rules
 *
 * userId is resolved from the real signed-in session (#1213), never trusted
 * from the request body. The route used to accept a client-supplied userId
 * — the ONLY real caller (app/settings/rules/page.tsx) always sent the
 * literal string 'playground', which is not a valid UUID and does not match
 * any row in `users`. rule_enforcement_db.service.ts's saveReport()/
 * recordViolation() insert into enforcement_reports.user_id / rule_violations
 * .user_id, both NOT NULL uuid columns with a real FK into users(id) — every
 * real validate call that found at least one violation (the entire point of
 * this feature) threw a Postgres 22P02/FK error and 500'd before ever
 * returning a report, making the Validation Playground and this route's own
 * persistence completely non-functional. Also closes an unauthenticated
 * write path: previously any caller could record a report/violation under
 * an arbitrary userId with zero auth check.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = (session as any)?.user?.id as string | undefined;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();

    // Validate request body
    const validated = actionSchema.parse(body);

    // Create action object — userId comes from the real session, never the body.
    const action: AgentAction = {
      ...validated,
      userId,
      timestamp: new Date(),
    };

    // Get enforcement service
    const service = getRuleEnforcementService();
    const dbService = getRuleEnforcementDbService();

    // Initialize if needed
    if (!service['config']) {
      await service.initialize({
        projectId: action.projectId,
        ruleSets: ['built-in'],
        ruleConfigs: [],
        settings: {
          autoFix: false,
          strictMode: false,
          continueOnError: true,
        },
      });
    }

    // Validate action
    const report = await service.validateAction(action);

    // Save report to database
    await dbService.saveReport(action.userId, action.projectId, report);

    // Record violations, keeping the persisted row id alongside each one.
    //
    // #1193: recordViolation() already `.returning()`s the inserted row, but
    // this route used to throw that away — which is why the auto-fix route's
    // "mark violations as fixed" loop was an empty body commented "in a real
    // implementation, we'd have violation IDs from the database". Surfacing
    // `violationId` here is the whole of that missing plumbing: a caller can
    // now hand the id back to POST /api/rules/auto-fix, which marks it via
    // markViolationFixed() so the violation history and /api/rules/stats
    // stop reporting auto-fixed violations as permanently pending.
    const violationsWithIds: Array<Record<string, unknown>> = [];
    for (const result of report.results) {
      for (const violation of result.violations) {
        const recorded = await dbService.recordViolation(
          result.ruleId,
          action.userId,
          action,
          violation
        );
        violationsWithIds.push({
          ...violation,
          violationId: (recorded as { id?: string } | undefined)?.id,
        });
      }
    }

    return NextResponse.json({
      success: true,
      report: {
        passed: report.passed,
        errorCount: report.errorCount,
        warningCount: report.warningCount,
        infoCount: report.infoCount,
        totalDuration: report.totalDuration,
        canAutoFix: report.canAutoFix,
        suggestions: report.suggestions,
        violations: violationsWithIds,
      },
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

    console.error('Error validating action:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to validate action',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
