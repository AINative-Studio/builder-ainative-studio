import { NextRequest, NextResponse } from 'next/server'
import { getPreview } from '@/lib/preview-store'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params

    // Get the stored preview content
    const content = getPreview(chatId)

    if (!content) {
      return NextResponse.json(
        { error: 'Code not found for this chat' },
        { status: 404 }
      )
    }

    // Extract code from markdown code blocks
    const codeMatch = content.match(/```(?:jsx|javascript|tsx|ts|js)?\n?([\s\S]*?)```/)

    let code = ''
    if (codeMatch && codeMatch[1]) {
      code = codeMatch[1].trim()
    } else {
      // If no code block found, try using raw content
      code = content.trim()
    }

    return NextResponse.json({
      code,
      chatId,
      language: 'jsx'
    })
  } catch (error) {
    console.error('Error fetching code:', error)
    return NextResponse.json(
      { error: 'Failed to fetch code' },
      { status: 500 }
    )
  }
}
