import { NextRequest, NextResponse } from 'next/server'
import { getPreview } from '@/lib/preview-store'
import { extractSingleFencedCode } from '@/lib/build/extract-single-fenced-code'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params

    // Get the stored preview content — in-memory first, falling back to the
    // durable ZeroDB record when this replica's Map missed it (chat
    // persistence fix, 2026-09-13: see lib/preview-store.ts's
    // getChatDataDurable doc comment for why the in-memory-only store lost
    // data on redeploy/restart/replica-switch).
    let content = getPreview(chatId)
    if (!content) {
      try {
        const { loadGeneration } = await import('@/lib/zerodb-store')
        const gen = await loadGeneration(chatId)
        if (gen?.generatedCode) content = gen.generatedCode
      } catch {
        // Best-effort — the 404 below still fires if this also fails.
      }
    }

    if (!content) {
      return NextResponse.json(
        { error: 'Code not found for this chat' },
        { status: 404 }
      )
    }

    // Extract code from markdown code blocks (decoy-nested-fence-aware — see extractSingleFencedCode)
    const extracted = extractSingleFencedCode(content)
    const code = extracted !== null ? extracted : content.trim()

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
