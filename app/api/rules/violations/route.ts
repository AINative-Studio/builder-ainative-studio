/**
 * Violations API Endpoint
 * GET /api/rules/violations - Get violation history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRuleEnforcementDbService } from '@/lib/services/rule-enforcement-db.service';

/**
 * GET /api/rules/violations
 * Get violation history with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId') || undefined;
    const projectId = searchParams.get('projectId') || undefined;
    const ruleId = searchParams.get('ruleId') || undefined;
    const fixed = searchParams.get('fixed')
      ? searchParams.get('fixed') === 'true'
      : undefined;
    const limit = searchParams.get('limit')
      ? parseInt(searchParams.get('limit')!)
      : 100;

    const dbService = getRuleEnforcementDbService();
    const violations = await dbService.getViolations({
      userId,
      projectId,
      ruleId,
      fixed,
      limit,
    });

    // Get stats
    const stats = await dbService.getViolationStats({
      userId,
      projectId,
      ruleId,
    });

    return NextResponse.json({
      success: true,
      violations,
      stats,
      count: violations.length,
    });
  } catch (error) {
    console.error('Error fetching violations:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch violations',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
