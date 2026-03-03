/**
 * A2UI WebSocket API Endpoint
 *
 * This endpoint handles WebSocket connections for the A2UI (Agent-to-UI)
 * dynamic preview system. It allows agents to send real-time UI updates
 * to connected clients.
 *
 * Protocol:
 * - Client connects via WebSocket
 * - Agent sends render/update messages
 * - Client displays dynamic UI components
 * - User actions are sent back to agent
 *
 * @route GET /api/a2ui
 */

import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * WebSocket upgrade handler
 * Note: Next.js App Router doesn't support WebSocket upgrades directly.
 * This is a placeholder. For production, use a separate WebSocket server
 * or a framework like Socket.io.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const chatId = searchParams.get('chatId')

  // Check if this is a WebSocket upgrade request
  const upgradeHeader = request.headers.get('upgrade')

  if (upgradeHeader?.toLowerCase() === 'websocket') {
    // WebSocket upgrade not directly supported in Next.js App Router
    // Return instructions for client
    return new Response(
      JSON.stringify({
        error: 'WebSocket upgrade not supported in this endpoint',
        message:
          'A2UI WebSocket server should be implemented separately or use Socket.io',
        suggestion:
          'Use polling endpoint /api/a2ui/poll or implement WebSocket server in server.js',
      }),
      {
        status: 426,
        headers: {
          'Content-Type': 'application/json',
          Upgrade: 'websocket',
        },
      }
    )
  }

  // Return API information for non-WebSocket requests
  return Response.json({
    name: 'A2UI WebSocket API',
    version: '1.0.0',
    description: 'Agent-to-UI dynamic preview system',
    chatId: chatId || 'not provided',
    endpoints: {
      websocket: {
        url: '/api/a2ui',
        protocol: 'ws://',
        description: 'WebSocket connection for real-time A2UI updates',
        note: 'Requires separate WebSocket server implementation',
      },
      polling: {
        url: '/api/a2ui/poll',
        method: 'GET',
        description: 'Long-polling alternative for A2UI updates',
      },
      action: {
        url: '/api/a2ui/action',
        method: 'POST',
        description: 'Send user actions to agent',
      },
    },
    status: 'development',
    features: [
      'Real-time component rendering',
      'Interactive previews',
      'Video integration support',
      'Agent-controlled layouts',
      'Bidirectional communication',
    ],
  })
}
