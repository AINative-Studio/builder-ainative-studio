/**
 * POST /api/build/company-app (#207 · FIX-2) — generate a REAL landing-page app
 * for a Company-track build (which otherwise has no running app), then register
 * slug → chatId so /build/{slug} shows it.
 *
 * The company track produces a business (thesis, wedge, pricing, landing copy)
 * but no deployed product — so its "prod URL" pointed at nothing. This builds a
 * real, idea-specific landing page via the same codegen pipeline used for apps,
 * and returns the chatId. Idempotent-ish: if the slug already resolves, returns it.
 *
 * Body: { idea, slug, name, tagline, color }
 * Returns: { chatId }
 */

import { NextRequest } from 'next/server'
import { registerApp, resolveApp } from '@/lib/build/app-registry'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const idea = String(b?.idea || '').trim().slice(0, 3000)
  const slug = String(b?.slug || '').slice(0, 40)
  if (!idea || !slug) return Response.json({ error: 'idea and slug required' }, { status: 400 })

  // Already built? return the existing chatId (don't regenerate).
  const existing = await resolveApp(slug).catch(() => null)
  if (existing?.chatId) return Response.json({ chatId: existing.chatId, cached: true })

  const name = String(b?.name || slug).slice(0, 120)
  const tagline = String(b?.tagline || '').slice(0, 200)
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b?.color || '')) ? String(b.color) : '#2f6d86'

  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  const message =
    `Build a polished, production-quality single-page marketing LANDING PAGE for "${name}"` +
    (tagline ? ` (tagline: "${tagline}")` : '') +
    ` — a real company for this idea: ${idea}. ` +
    `Include: a hero with the value prop and a "Get early access" CTA, a 3-feature section, ` +
    `a how-it-works section, pricing (3 tiers), and a footer. Use ${color} as the primary brand color. ` +
    `Make it visually distinctive and specific to this company, with realistic copy — not a generic template.`

  // Kick codegen; read the SSE stream only far enough to get the chatId. Generation
  // continues server-side and populates the preview store (durable via ZeroDB).
  try {
    const res = await fetch(`${base}/api/chat-ws`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(280_000),
    })
    if (!res.body) return Response.json({ error: 'no stream' }, { status: 502 })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = '', chatId: string | null = null, sawRefresh = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const events = buf.split('\n\n'); buf = events.pop() || ''
      for (const ev of events) {
        const line = ev.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        let p: any; try { p = JSON.parse(line.slice(5).trim()) } catch { continue }
        if (p.type === 'init' && p.chatId) chatId = p.chatId
        if (p.type === 'refresh' || p.type === 'files') sawRefresh = true
      }
      // We have the id and at least one refresh → register and return; generation
      // finishes server-side and /build/{slug} re-renders from the durable store.
      if (chatId && sawRefresh) break
    }
    if (!chatId) return Response.json({ error: 'no chatId' }, { status: 502 })

    await registerApp({ slug, chatId, name, tagline, color, track: 'company' })
    return Response.json({ chatId })
  } catch (e: any) {
    return Response.json({ error: 'generation_failed', detail: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
