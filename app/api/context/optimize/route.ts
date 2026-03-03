/**
 * POST /api/context/optimize
 *
 * Get optimization suggestions for reducing token usage
 */

import { NextRequest, NextResponse } from 'next/server';
import { contextBudgetService } from '@/lib/services/context-budget.service';
import { logger } from '@/lib/logger';
import type { OptimizeRequest, OptimizeResponse } from '@/lib/types/context-budget';

export async function POST(request: NextRequest) {
  try {
    const body: OptimizeRequest = await request.json();

    const { sessionId, userId, aggressiveness = 'moderate', targetReduction } = body;

    if (!sessionId || !userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: sessionId, userId',
        },
        { status: 400 }
      );
    }

    if (
      aggressiveness &&
      !['conservative', 'moderate', 'aggressive'].includes(aggressiveness)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Invalid aggressiveness. Must be one of: conservative, moderate, aggressive',
        },
        { status: 400 }
      );
    }

    // Get current budget
    const budget = await contextBudgetService.getBudget(sessionId, userId);

    // Get optimization suggestions
    const suggestions = await contextBudgetService.getOptimizationSuggestions(
      sessionId,
      userId,
      aggressiveness
    );

    // Calculate estimated savings
    const estimatedSavings = suggestions.reduce(
      (sum, suggestion) => sum + suggestion.estimatedSavings,
      0
    );

    // Calculate target usage
    const targetUsage = targetReduction
      ? budget.used - targetReduction
      : budget.used - estimatedSavings;

    const response: OptimizeResponse = {
      success: true,
      suggestions,
      estimatedSavings,
      currentUsage: budget.used,
      targetUsage: Math.max(0, targetUsage),
    };

    logger.info('Optimization suggestions generated', {
      sessionId,
      userId,
      suggestionsCount: suggestions.length,
      estimatedSavings,
      aggressiveness,
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Failed to generate optimization suggestions', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
