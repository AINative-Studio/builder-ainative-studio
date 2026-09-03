import { NextRequest } from 'next/server'
import { resolveApp } from '@/lib/build/app-registry'
import { toSlug } from '@/lib/build/slug'

export const runtime = 'nodejs'

/**
 * Advisory name-availability check (#479) — the founder's own manual rename
 * (CompanyNameEdit's inline edit) never calls /api/build/brand at all, so it
 * had zero collision awareness. Unlike #478 (which PREVENTS the LLM from ever
 * proposing a taken name), this is explicitly advisory-only: a founder typing
 * their own chosen name must never be silently blocked — they just deserve to
 * know, before saving, if that name is already someone else's company.
 *
 * "Different chatId" is the real collision signal (matches #478's own slug-
 * collision reasoning) — editing then reverting to a company's OWN existing
 * name must never false-warn.
 *
 * Fails open: any registry lookup error returns available:true so an infra
 * hiccup never blocks a rename the founder is trying to make.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const chatId = typeof body?.chatId === 'string' ? body.chatId : ''
    if (!name) return Response.json({ available: true })

    const slug = toSlug(name)
    const existing = await resolveApp(slug)
    const takenByOther = Boolean(existing && existing.chatId && existing.chatId !== chatId)

    return Response.json({
      available: !takenByOther,
      slug,
      existingName: takenByOther ? existing?.name || name : undefined,
    })
  } catch {
    // Fail open — a lookup error must never block a founder's rename.
    return Response.json({ available: true })
  }
}
