/**
 * Command Favorite API Route
 *
 * Endpoint:
 * POST /api/commands/[commandId]/favorite - Toggle favorite status
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

    const commandService = getCommandService();

    // Toggle favorite
    const isFavorite = await commandService.toggleFavorite(
      params.commandId,
      session.user.id
    );

    return NextResponse.json({ isFavorite });
  } catch (error) {
    console.error('Favorite toggle error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
