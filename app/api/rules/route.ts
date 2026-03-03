/**
 * Rules API Endpoint
 * GET /api/rules - List all enforcement rules
 * POST /api/rules - Create a custom rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRuleEnforcementDbService } from '@/lib/services/rule-enforcement-db.service';
import { z } from 'zod';

// Validation schema for rule creation
const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  level: z.enum(['error', 'warning', 'info']).default('warning'),
  category: z.enum([
    'git',
    'file-placement',
    'testing',
    'security',
    'code-quality',
    'documentation',
    'database',
    'deployment',
  ]),
  contexts: z.array(z.string()),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  docsUrl: z.string().url().optional(),
  examples: z
    .array(
      z.object({
        invalid: z.string(),
        valid: z.string(),
        explanation: z.string(),
      })
    )
    .optional(),
});

/**
 * GET /api/rules
 * List all enforcement rules with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category') || undefined;
    const enabled = searchParams.get('enabled')
      ? searchParams.get('enabled') === 'true'
      : undefined;
    const level = searchParams.get('level') || undefined;

    const dbService = getRuleEnforcementDbService();
    const rules = await dbService.getRules({ category, enabled, level });

    return NextResponse.json({
      success: true,
      rules,
      count: rules.length,
    });
  } catch (error) {
    console.error('Error fetching rules:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch rules',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rules
 * Create a new custom enforcement rule
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    const validated = ruleSchema.parse(body);

    const dbService = getRuleEnforcementDbService();
    const rule = await dbService.upsertRule(validated);

    return NextResponse.json(
      {
        success: true,
        rule,
        message: 'Rule created successfully',
      },
      { status: 201 }
    );
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

    console.error('Error creating rule:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create rule',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
