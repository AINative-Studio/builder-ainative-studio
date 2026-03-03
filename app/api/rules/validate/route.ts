/**
 * Rule Validation API Endpoint
 * POST /api/rules/validate - Validate an action against all applicable rules
 */

import { NextRequest, NextResponse } from 'next/server';
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
    metadata: z.record(z.unknown()).optional(),
  }),
  userId: z.string(),
  projectId: z.string(),
});

/**
 * POST /api/rules/validate
 * Validate an action against all applicable rules
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    const validated = actionSchema.parse(body);

    // Create action object
    const action: AgentAction = {
      ...validated,
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

    // Record violations
    for (const result of report.results) {
      for (const violation of result.violations) {
        await dbService.recordViolation(
          result.ruleId,
          action.userId,
          action,
          violation
        );
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
        violations: report.results.flatMap((r) => r.violations),
      },
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
