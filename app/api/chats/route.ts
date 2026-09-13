import { NextRequest, NextResponse } from 'next/server'
import { getAllChats } from '@/lib/preview-store'

export async function GET(request: NextRequest) {
  try {
    // In-memory chats (current session)
    const memoryChats = getAllChats()

    // Also fetch from ZeroDB (persists across deploys)
    let zerodbChats: any[] = []
    try {
      const { listGenerations } = await import('@/lib/zerodb-store')
      const rows = await listGenerations(50)
      // Multi-turn chats append one row per turn (chat persistence fix,
      // 2026-09-13) — dedupe by chat_id, keeping the OLDEST row's created_at
      // (a chat's real start time) so a long-running conversation doesn't
      // appear to have just started every time it gets a new turn.
      const byId = new Map<string, any>()
      for (const r of rows) {
        if (!r.chat_id || !r.prompt) continue
        const existing = byId.get(r.chat_id)
        if (!existing || String(r.created_at || '') < String(existing.created_at || '')) {
          byId.set(r.chat_id, r)
        }
      }
      zerodbChats = Array.from(byId.values())
        .map((r: any) => ({
          id: r.chat_id,
          title: r.title || r.prompt?.replace(/^Build\s+(a|an)\s+/i, '').split(/[.!,]/)[0]?.trim()?.slice(0, 50) || 'Untitled',
          createdAt: r.created_at || new Date().toISOString(),
          demo: `/preview/${r.chat_id}`,
        }))
    } catch {
      // ZeroDB unavailable — use memory only
    }

    // Merge and deduplicate by id
    const seen = new Set<string>()
    const allChats: any[] = []
    for (const chat of [...memoryChats, ...zerodbChats]) {
      const id = chat.id
      if (id && !seen.has(id)) {
        seen.add(id)
        allChats.push(chat)
      }
    }

    return NextResponse.json({ data: allChats })
  } catch (error: any) {
    console.error('Error fetching chats:', error?.message, error?.stack)
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 }
    )
  }
}
