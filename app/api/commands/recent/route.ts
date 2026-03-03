/**
 * Recent Commands API Route
 *
 * Endpoint:
 * GET /api/commands/recent - Get recently executed commands
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCommandService } from '@/lib/services/agent-command.service';
import { auth } from '@/lib/auth';

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

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10');

    const commandService = getCommandService();
    const recentCommands = await commandService.getRecentCommands(
      session.user.id,
      limit
    );

    return NextResponse.json({ commands: recentCommands });
  } catch (error) {
    console.error('Recent commands error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
