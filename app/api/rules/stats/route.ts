/**
 * Rule Statistics API Endpoint
 * GET /api/rules/stats - Get enforcement statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRuleEnforcementDbService } from '@/lib/services/rule-enforcement-db.service';

/**
 * GET /api/rules/stats
 * Get comprehensive enforcement statistics
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId') || undefined;
    const projectId = searchParams.get('projectId') || undefined;
    const ruleId = searchParams.get('ruleId') || undefined;

    const dbService = getRuleEnforcementDbService();

    // Get violation stats
    const violationStats = await dbService.getViolationStats({
      userId,
      projectId,
      ruleId,
    });

    // Get reports
    const reports = await dbService.getReports({
      userId,
      projectId,
      limit: 100,
    });

    // Calculate report stats
    const passedReports = reports.filter((r) => r.passed).length;
    const failedReports = reports.filter((r) => !r.passed).length;
    const passRate = reports.length > 0 ? (passedReports / reports.length) * 100 : 0;

    // Get top violated rules
    const violations = await dbService.getViolations({
      userId,
      projectId,
      limit: 1000,
    });

    const ruleViolationCounts = violations.reduce((acc, v) => {
      acc[v.rule_id] = (acc[v.rule_id] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topViolatedRules = Object.entries(ruleViolationCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([ruleId, count]) => ({ ruleId, count }));

    return NextResponse.json({
      success: true,
      stats: {
        violations: violationStats,
        reports: {
          total: reports.length,
          passed: passedReports,
          failed: failedReports,
          passRate: Math.round(passRate * 100) / 100,
        },
        topViolatedRules,
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch statistics',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
