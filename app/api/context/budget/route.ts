/**
 * GET /api/context/budget
 *
 * Get current context budget for a session
 */

import { NextRequest, NextResponse } from 'next/server';
import { contextBudgetService } from '@/lib/services/context-budget.service';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { context_items } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const userId = searchParams.get('userId');
    const includeHistory = searchParams.get('includeHistory') === 'true';
    const includeSuggestions = searchParams.get('includeSuggestions') === 'true';

    if (!sessionId || !userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required parameters: sessionId and userId',
        },
        { status: 400 }
      );
    }

    // Get budget
    const budget = await contextBudgetService.getBudget(sessionId, userId);

    // Get all items
    const dbItems = await db.query.context_items.findMany({
      where: and(
        eq(context_items.session_id, sessionId),
        eq(context_items.status, 'loaded')
      ),
    });

    const items = dbItems.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      tokenCost: item.token_cost,
      priority: item.priority,
      status: item.status,
      lastAccessedAt: item.last_accessed_at,
      accessCount: item.access_count,
      metadata: item.metadata,
      loadedAt: item.loaded_at,
      sessionId: item.session_id,
      userId: item.user_id,
    }));

    const response: any = {
      success: true,
      budget,
      items,
    };

    // Include optimization suggestions if requested
    if (includeSuggestions) {
      const suggestions = await contextBudgetService.getOptimizationSuggestions(
        sessionId,
        userId,
        'moderate'
      );
      response.suggestions = suggestions;
    }

    // Include history if requested
    if (includeHistory) {
      const events = await db.query.budget_events.findMany({
        where: eq(context_items.session_id, sessionId),
        orderBy: (events, { desc }) => [desc(events.created_at)],
        limit: 50,
      });

      response.history = events.map((event) => ({
        id: event.id,
        sessionId: event.session_id,
        userId: event.user_id,
        eventType: event.event_type,
        itemId: event.item_id,
        tokenDelta: event.token_delta,
        budgetSnapshot: event.budget_snapshot,
        timestamp: event.created_at,
        metadata: event.metadata,
      }));
    }

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Failed to get context budget', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
