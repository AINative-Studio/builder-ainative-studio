/**
 * POST /api/context/unload
 *
 * Unload one or more context items to free up tokens
 */

import { NextRequest, NextResponse } from 'next/server';
import { contextBudgetService } from '@/lib/services/context-budget.service';
import { logger } from '@/lib/logger';
import type { UnloadItemsRequest, UnloadItemsResponse, ContextItem } from '@/lib/types/context-budget';

export async function POST(request: NextRequest) {
  try {
    const body: UnloadItemsRequest = await request.json();

    const { sessionId, userId, itemIds, reason } = body;

    if (!sessionId || !userId || !itemIds || !Array.isArray(itemIds)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: sessionId, userId, itemIds (array)',
        },
        { status: 400 }
      );
    }

    if (itemIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'itemIds array cannot be empty',
        },
        { status: 400 }
      );
    }

    const unloadedItems: ContextItem[] = [];
    let tokensSaved = 0;

    // Unload each item
    for (const itemId of itemIds) {
      try {
        // Get item details first
        const item = await contextBudgetService.getItemById(itemId);

        if (!item) {
          logger.warn('Item not found for unloading', { itemId, sessionId });
          continue;
        }

        // Unload the item
        const result = await contextBudgetService.trackItem(
          sessionId,
          userId,
          {
            type: item.type,
            name: item.name,
            tokenCost: item.tokenCost,
            priority: item.priority,
            status: item.status,
            metadata: item.metadata,
          },
          'unload'
        );

        unloadedItems.push(result.item);
        tokensSaved += item.tokenCost;
      } catch (error) {
        logger.error('Failed to unload item', { itemId, error });
      }
    }

    // Get updated budget
    const budget = await contextBudgetService.getBudget(sessionId, userId);

    const response: UnloadItemsResponse = {
      success: true,
      unloadedItems,
      budget,
      tokensSaved,
    };

    logger.info('Context items unloaded', {
      sessionId,
      userId,
      itemCount: unloadedItems.length,
      tokensSaved,
      reason,
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Failed to unload context items', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
