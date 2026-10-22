/**
 * A2UI Action Endpoint
 *
 * Receives user actions from an A2UI preview and forwards them to the agent
 * attached to the chat.
 *
 * #1193: this handler previously logged the action, discarded it, and still
 * answered `{ success: true, message: 'Action received' }` — a silent no-op
 * that looked like a working endpoint. It now forwards the action onto the
 * real per-chat queue drained by `GET /api/a2ui/poll` (the only live A2UI
 * transport in this deployment: there is no WebSocket server, and
 * `GET /api/a2ui` answers an upgrade with 426), and reports the true delivery
 * outcome — 202 when an agent consumer actually received it, 503 with a
 * machine-readable `reason` when nothing is listening.
 *
 * @route POST /api/a2ui/action
 */

import { NextRequest } from 'next/server'
import { enqueueAgentAction } from '@/lib/a2ui/action-queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'Request body must be valid JSON' },
      { status: 400 }
    )
  }

  try {
    const { chatId, action, context } = body ?? {}

    if (!chatId || typeof chatId !== 'string') {
      return Response.json(
        { error: 'chatId and action are required' },
        { status: 400 }
      )
    }
    if (!action || typeof action !== 'string') {
      return Response.json(
        { error: 'chatId and action are required' },
        { status: 400 }
      )
    }

    const result = enqueueAgentAction(chatId, action, context)

    if (!result.delivered) {
      // Honest failure: the action was NOT handed to any agent. The preview
      // should surface this rather than behave as though the agent acted.
      return Response.json(
        {
          delivered: false,
          reason: result.reason,
          message:
            'No A2UI agent consumer is attached to this chat, so the action was not forwarded. Open an A2UI preview session (which polls /api/a2ui/poll) and retry.',
          data: { chatId, action },
        },
        { status: 503 }
      )
    }

    return Response.json(
      {
        delivered: true,
        transport: 'poll-queue',
        actionId: result.actionId,
        data: { chatId, action, context: context ?? null },
      },
      { status: 202 }
    )
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
