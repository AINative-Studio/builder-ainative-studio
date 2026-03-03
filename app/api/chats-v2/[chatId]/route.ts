import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getChat, getMessagesByChatId, deleteChat } from '@/lib/db/queries'

interface RouteParams {
  params: Promise<{ chatId: string }>
}

/**
 * US-002: GET /api/chats-v2/:chatId
 * Get a single chat with all messages
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  return withAuth(request, async (req) => {
    try {
      const { chatId } = await params
      const userId = req.userId!

      // Get chat
      const chat = await getChat(chatId)

      if (!chat) {
        return NextResponse.json(
          { error: 'Chat not found' },
          { status: 404 }
        )
      }

      // Verify ownership
      if (chat.user_id !== userId) {
        return NextResponse.json(
          { error: 'Access denied' },
          { status: 403 }
        )
      }

      // Get all messages
      const messages = await getMessagesByChatId(chatId)

      return NextResponse.json(
        {
          chat: {
            id: chat.id,
            name: chat.name,
            createdAt: chat.created_at.toISOString(),
            updatedAt: chat.updated_at.toISOString(),
          },
          messages: messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: msg.created_at.toISOString(),
          })),
        },
        { status: 200 }
      )
    } catch (error) {
      console.error('Failed to get chat:', error)
      return NextResponse.json(
        { error: 'Failed to retrieve chat' },
        { status: 500 }
      )
    }
  })
}

/**
 * DELETE /api/chats-v2/:chatId
 * Delete a chat and all its messages
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  return withAuth(request, async (req) => {
    try {
      const { chatId } = await params
      const userId = req.userId!

      // Get chat
      const chat = await getChat(chatId)

      if (!chat) {
        return NextResponse.json(
          { error: 'Chat not found' },
          { status: 404 }
        )
      }

      // Verify ownership
      if (chat.user_id !== userId) {
        return NextResponse.json(
          { error: 'Access denied' },
          { status: 403 }
        )
      }

      // Delete chat (cascade deletes messages)
      await deleteChat(chatId)

      return NextResponse.json(
        { success: true, message: 'Chat deleted successfully' },
        { status: 200 }
      )
    } catch (error) {
      console.error('Failed to delete chat:', error)
      return NextResponse.json(
        { error: 'Failed to delete chat' },
        { status: 500 }
      )
    }
  })
}
