/**
 * POST /api/build/register-app (#207 · FIX-2) — register a brand slug → generated
 * app chatId so /build/{slug} resolves to the real running app. GET ?slug= reads it.
 */

import { NextRequest } from 'next/server'
import { registerApp, resolveApp } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  if (!b?.slug || !b?.chatId) return Response.json({ error: 'slug and chatId required' }, { status: 400 })
  const ok = await registerApp({
    slug: String(b.slug).slice(0, 40),
    chatId: String(b.chatId).slice(0, 64),
    name: b.name ? String(b.name).slice(0, 120) : undefined,
    tagline: b.tagline ? String(b.tagline).slice(0, 200) : undefined,
    color: b.color ? String(b.color).slice(0, 9) : undefined,
    track: b.track === 'company' ? 'company' : 'app',
  })
  return Response.json({ ok })
}

export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get('slug') || ''
  const entry = await resolveApp(slug)
  return Response.json({ entry })
}
