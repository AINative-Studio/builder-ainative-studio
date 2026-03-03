/**
 * A2UI Action Endpoint
 *
 * Receives user actions from A2UI preview and forwards them to the agent.
 *
 * @route POST /api/a2ui/action
 */

import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { chatId, action, context } = body

    if (!chatId || !action) {
      return Response.json(
        { error: 'chatId and action are required' },
        { status: 400 }
      )
    }

    console.log('[A2UI Action]', {
      chatId,
      action,
      context,
      timestamp: new Date().toISOString(),
    })

    // TODO: Forward action to agent
    // This could be:
    // 1. Sent to agent via WebSocket
    // 2. Stored in Redis for agent to poll
    // 3. Sent to agent's API endpoint
    // 4. Added to chat message queue

    // For now, just log and return success
    return Response.json({
      success: true,
      message: 'Action received',
      data: {
        chatId,
        action,
        context,
      },
    })
  } catch (error) {
    console.error('[A2UI Action] Error:', error)
    return Response.json(
      {
        error: 'Failed to process action',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
