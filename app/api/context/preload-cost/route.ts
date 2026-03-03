/**
 * POST /api/context/preload-cost
 *
 * Calculate pre-load cost and check if item can be loaded
 */

import { NextRequest, NextResponse } from 'next/server';
import { contextBudgetService } from '@/lib/services/context-budget.service';
import { logger } from '@/lib/logger';
import type {
  CalculatePreLoadCostRequest,
  CalculatePreLoadCostResponse,
} from '@/lib/types/context-budget';

export async function POST(request: NextRequest) {
  try {
    const body: CalculatePreLoadCostRequest = await request.json();

    const { sessionId, userId, item } = body;

    if (!sessionId || !userId || !item) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: sessionId, userId, item',
        },
        { status: 400 }
      );
    }

    // Validate item structure
    if (!item.type || !item.name || item.tokenCost === undefined || !item.priority) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid item structure. Required fields: type, name, tokenCost, priority',
        },
        { status: 400 }
      );
    }

    // Calculate pre-load cost
    const preLoadCost = await contextBudgetService.calculatePreLoadCost(
      sessionId,
      userId,
      item
    );

    const response: CalculatePreLoadCostResponse = {
      success: true,
      preLoadCost,
    };

    logger.debug('Pre-load cost calculated', {
      sessionId,
      userId,
      itemName: item.name,
      canLoad: preLoadCost.canLoad,
      estimatedCost: preLoadCost.estimatedCost,
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Failed to calculate pre-load cost', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
