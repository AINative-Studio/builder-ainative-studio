import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { getPreview, getChatData } from '@/lib/preview-store'
import { getChatOwnership } from '@/lib/db/queries'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    if (!chatId) {
      return NextResponse.json(
        { error: 'Chat ID is required' },
        { status: 400 }
      )
    }

    // Verify chat ownership (allow access if no ownership record exists for backward compat)
    const ownership = await getChatOwnership({ chatId })
    if (ownership && ownership.user_id !== session.user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    console.log('Getting chat details for ID:', chatId)

    // For our LLAMA implementation, we need to construct the response
    // that matches what the frontend expects with demoUrl

    // Check if we have chat data stored for this chat
    const chatData = getChatData(chatId)

    if (chatData) {
      // We have local chat data, return it in the expected format
      const response = {
        id: chatId,
        demo: `/preview/${chatId}`,
        latestVersion: {
          demoUrl: `/api/preview/${chatId}`
        },
        messages: chatData.messages
      }

      console.log('Returning chat details with messages:', response.messages.length, 'messages')
      return NextResponse.json(response)
    }

    // If no chat data found, return minimal response
    console.log('No chat data found for chat ID:', chatId)
    return NextResponse.json(
      { error: 'Chat not found' },
      { status: 404 }
    )

  } catch (error) {
    console.error('Error getting chat details:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve chat details' },
      { status: 500 }
    )
  }
}