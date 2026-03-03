/**
 * Commands API Route
 *
 * Endpoints:
 * GET /api/commands - Search and list commands
 * POST /api/commands - Create a new command
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCommandService } from '@/lib/services/agent-command.service';
import { auth } from '@/lib/auth';
import type { CommandSearchQuery, AgentCommand } from '@/lib/types/agent-commands';

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const query: CommandSearchQuery = {
      query: searchParams.get('query') || undefined,
      category: searchParams.get('category') as any || undefined,
      tags: searchParams.get('tags')?.split(',') || undefined,
      authorId: searchParams.get('authorId') || undefined,
      builtInOnly: searchParams.get('builtInOnly') === 'true',
      teamOnly: searchParams.get('teamOnly') === 'true',
      favoritesOnly: searchParams.get('favoritesOnly') === 'true',
      sortBy: (searchParams.get('sortBy') as any) || 'relevance',
      limit: parseInt(searchParams.get('limit') || '20'),
      offset: parseInt(searchParams.get('offset') || '0'),
    };

    const commandService = getCommandService();
    const result = await commandService.searchCommands(session.user.id, query);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Commands GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.name || !body.description || !body.template) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create command
    const commandService = getCommandService();
    const command = await commandService.createCommand(
      {
        metadata: {
          name: body.name,
          description: body.description,
          category: body.category || 'custom',
          icon: body.icon,
          tags: body.tags || [],
          author: {
            id: session.user.id,
            name: session.user.name || session.user.email || 'Unknown',
          },
          isBuiltIn: false,
          isTeam: body.isTeam || false,
          teamId: body.teamId,
          isActive: true,
          shortcut: body.shortcut,
        },
        template: body.template,
        variables: body.variables || [],
        requiredSkills: body.requiredSkills || [],
        preConditions: body.preConditions || [],
        checkpoints: body.checkpoints || [],
        output: body.output || { type: 'chat' },
        validationRules: body.validationRules,
        estimatedTokenCost: body.estimatedTokenCost,
        version: body.version || '1.0.0',
      },
      session.user.id
    );

    return NextResponse.json(command, { status: 201 });
  } catch (error) {
    console.error('Commands POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
