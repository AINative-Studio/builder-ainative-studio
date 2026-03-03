/**
 * POST /api/context/track
 *
 * Track a context item (load, unload, or access)
 */

import { NextRequest, NextResponse } from 'next/server';
import { contextBudgetService } from '@/lib/services/context-budget.service';
import { logger } from '@/lib/logger';
import type { TrackItemRequest, TrackItemResponse } from '@/lib/types/context-budget';

export async function POST(request: NextRequest) {
  try {
    const body: TrackItemRequest = await request.json();

    const { sessionId, userId, item, action } = body;

    if (!sessionId || !userId || !item || !action) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: sessionId, userId, item, action',
        },
        { status: 400 }
      );
    }

    if (!['load', 'unload', 'access'].includes(action)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid action. Must be one of: load, unload, access',
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

    // Track the item
    const result = await contextBudgetService.trackItem(
      sessionId,
      userId,
      item,
      action
    );

    const response: TrackItemResponse = {
      success: true,
      item: result.item,
      budget: result.budget,
      warnings: result.warnings,
    };

    logger.info('Context item tracked', {
      sessionId,
      userId,
      itemName: item.name,
      action,
      tokenCost: item.tokenCost,
      warnings: result.warnings,
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Failed to track context item', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
