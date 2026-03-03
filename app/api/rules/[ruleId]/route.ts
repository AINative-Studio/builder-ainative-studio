/**
 * Single Rule API Endpoint
 * GET /api/rules/[ruleId] - Get a specific rule
 * PUT /api/rules/[ruleId] - Update a rule
 * DELETE /api/rules/[ruleId] - Delete a rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRuleEnforcementDbService } from '@/lib/services/rule-enforcement-db.service';
import { z } from 'zod';

const ruleUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  level: z.enum(['error', 'warning', 'info']).optional(),
  enabled: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  docsUrl: z.string().url().optional(),
});

/**
 * GET /api/rules/[ruleId]
 * Get details of a specific rule
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { ruleId: string } }
) {
  try {
    const { ruleId } = params;

    const dbService = getRuleEnforcementDbService();
    const rule = await dbService.getRule(ruleId);

    if (!rule) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rule not found',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      rule,
    });
  } catch (error) {
    console.error('Error fetching rule:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch rule',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/rules/[ruleId]
 * Update a rule
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { ruleId: string } }
) {
  try {
    const { ruleId } = params;
    const body = await request.json();

    // Validate request body
    const validated = ruleUpdateSchema.parse(body);

    const dbService = getRuleEnforcementDbService();

    // Check if rule exists
    const existing = await dbService.getRule(ruleId);
    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rule not found',
        },
        { status: 404 }
      );
    }

    // Update rule
    const updated = await dbService.upsertRule({
      ...existing,
      ...validated,
      id: ruleId,
    });

    return NextResponse.json({
      success: true,
      rule: updated,
      message: 'Rule updated successfully',
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

    console.error('Error updating rule:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update rule',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/rules/[ruleId]
 * Delete a rule
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { ruleId: string } }
) {
  try {
    const { ruleId } = params;

    const dbService = getRuleEnforcementDbService();

    // Check if rule exists
    const existing = await dbService.getRule(ruleId);
    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rule not found',
        },
        { status: 404 }
      );
    }

    // Prevent deletion of built-in rules
    if (existing.rule_set_id) {
      // Check if it's a built-in rule
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot delete built-in rules',
        },
        { status: 403 }
      );
    }

    await dbService.deleteRule(ruleId);

    return NextResponse.json({
      success: true,
      message: 'Rule deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting rule:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete rule',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
