/**
 * Command Execution API Route
 *
 * Endpoint:
 * POST /api/commands/[commandId]/execute - Execute a command with variables
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCommandService } from '@/lib/services/agent-command.service';
import { auth } from '@/lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: { commandId: string } }
) {
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
    const { variableValues, chatId, gitContext } = body;

    const commandService = getCommandService();

    // Get command
    const command = await commandService.getCommand(
      params.commandId,
      session.user.id
    );

    if (!command) {
      return NextResponse.json(
        { error: 'Command not found' },
        { status: 404 }
      );
    }

    // Validate variables
    const validation = commandService.validateVariables(
      command.variables,
      variableValues || {}
    );

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          validationErrors: validation.errors,
        },
        { status: 400 }
      );
    }

    // Execute command
    const executionState = await commandService.executeCommand(command, {
      command,
      variableValues: variableValues || {},
      userId: session.user.id,
      chatId,
      gitContext,
    });

    return NextResponse.json(executionState);
  } catch (error) {
    console.error('Command execution error:', error);
    return NextResponse.json(
      {
        error: 'Execution failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
