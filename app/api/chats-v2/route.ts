import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getChatsByUserId, getMessagesByChatId } from '@/lib/db/queries'

/**
 * US-002: GET /api/chats-v2
 * Get all chats for authenticated user with message preview
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (req) => {
    try {
      const userId = req.userId!

      // Get all chats for user
      const chats = await getChatsByUserId(userId)

      // Enrich with message preview (last message)
      const chatsWithPreview = await Promise.all(
        chats.map(async (chat) => {
          const messages = await getMessagesByChatId(chat.id)
          const lastMessage = messages[messages.length - 1]

          return {
            id: chat.id,
            name: chat.name,
            createdAt: chat.created_at.toISOString(),
            updatedAt: chat.updated_at.toISOString(),
            messageCount: messages.length,
            lastMessage: lastMessage
              ? {
                  role: lastMessage.role,
                  content:
                    lastMessage.content.length > 100
                      ? lastMessage.content.slice(0, 100) + '...'
                      : lastMessage.content,
                  createdAt: lastMessage.created_at.toISOString(),
                }
              : null,
          }
        })
      )

      return NextResponse.json(
        { chats: chatsWithPreview },
        { status: 200 }
      )
    } catch (error) {
      console.error('Failed to get chats:', error)
      return NextResponse.json(
        { error: 'Failed to retrieve chats' },
        { status: 500 }
      )
    }
  })
}
