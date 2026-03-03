/**
 * Single Command API Route
 *
 * Endpoints:
 * GET /api/commands/[commandId] - Get command by ID
 * PUT /api/commands/[commandId] - Update command
 * DELETE /api/commands/[commandId] - Delete command
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCommandService } from '@/lib/services/agent-command.service';
import { auth } from '@/lib/auth';

export async function GET(
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

    const commandService = getCommandService();
    const command = await commandService.getCommand(params.commandId, session.user.id);

    if (!command) {
      return NextResponse.json(
        { error: 'Command not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(command);
  } catch (error) {
    console.error('Command GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
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

    const commandService = getCommandService();

    // Check if command exists and user has permission
    const existingCommand = await commandService.getCommand(
      params.commandId,
      session.user.id
    );

    if (!existingCommand) {
      return NextResponse.json(
        { error: 'Command not found' },
        { status: 404 }
      );
    }

    // Only allow updating own commands (or team commands if authorized)
    if (
      existingCommand.metadata.author.id !== session.user.id &&
      !existingCommand.metadata.isBuiltIn
    ) {
      return NextResponse.json(
        { error: 'Forbidden: Cannot update this command' },
        { status: 403 }
      );
    }

    // Update command
    const updatedCommand = await commandService.updateCommand(
      params.commandId,
      body,
      session.user.id
    );

    return NextResponse.json(updatedCommand);
  } catch (error) {
    console.error('Command PUT error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const commandService = getCommandService();

    // Check if command exists and user has permission
    const existingCommand = await commandService.getCommand(
      params.commandId,
      session.user.id
    );

    if (!existingCommand) {
      return NextResponse.json(
        { error: 'Command not found' },
        { status: 404 }
      );
    }

    // Only allow deleting own commands
    if (
      existingCommand.metadata.author.id !== session.user.id &&
      !existingCommand.metadata.isBuiltIn
    ) {
      return NextResponse.json(
        { error: 'Forbidden: Cannot delete this command' },
        { status: 403 }
      );
    }

    // Don't allow deleting built-in commands
    if (existingCommand.metadata.isBuiltIn) {
      return NextResponse.json(
        { error: 'Cannot delete built-in commands' },
        { status: 403 }
      );
    }

    await commandService.deleteCommand(params.commandId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Command DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
