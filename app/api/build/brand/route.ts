/**
 * POST /api/build/brand (#207 · FIX-1) — generate a REAL brand for the idea.
 *
 * The old flow named the company from the first 3 words of the idea ("I Want To")
 * and slugged the raw idea into a garbage subdomain ("i-want-to-build-a-softwa").
 * This generates a proper brand: a real product name, a clean URL slug, a tagline,
 * and a brand accent color — all from the idea, via the tiered Claude stack.
 *
 * Body: { idea, track }
 * Returns: { name, slug, tagline, color }
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { getClaudeCompletion } from '@/lib/build/claude-completion'

export const runtime = 'nodejs'

const ainative = new OpenAI({
  apiKey: process.env.AINATIVE_API_KEY || process.env.API_Key || process.env.ZERODB_API_KEY || '',
  baseURL: (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1',
})

/** Clean slug: lowercase, alnum + single dashes, <= 24 chars, no leading/trailing dash. */
function toSlug(name: string): string {
  const s = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
  return s || 'app'
}

function parseJson(raw: string): any {
  if (!raw) return null
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a === -1 || b < a) return null
  try { return JSON.parse(s.slice(a, b + 1)) } catch { return null }
}

const SYSTEM =
  'You are a startup brand namer. Given a product idea, invent ONE real, memorable, ' +
  'brandable product name (like Stripe, Notion, Linear, Vercel) — short (1-2 words), ' +
  'not a literal description of the idea, no generic words like "App"/"Platform"/"Software", ' +
  'not the raw idea text. Also give a one-line tagline and a hex brand accent color. ' +
  'Return ONLY minified JSON: {"name","tagline","color"}'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const idea = String(body?.idea || '').trim().slice(0, 2000)
  if (!idea) return Response.json({ error: 'idea required' }, { status: 400 })

  const user = `Product idea: """${idea}"""\nInvent the brand. JSON: {"name","tagline","color"}`

  const claude = getClaudeCompletion()
  if (claude) {
    try {
      const res = await claude.client.messages.create({
        model: claude.model, max_tokens: 200, temperature: 0.9, system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      })
      const text = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      const j = parseJson(text)
      if (j?.name) {
        return Response.json({ name: j.name, slug: toSlug(j.name), tagline: j.tagline || '', color: sanitizeColor(j.color) })
      }
    } catch { /* fall through */ }
  }

  try {
    const res = await ainative.chat.completions.create({
      model: 'claude-sonnet-4.5', max_tokens: 200, temperature: 0.9,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    })
    const j = parseJson(res.choices?.[0]?.message?.content || '')
    if (j?.name) {
      return Response.json({ name: j.name, slug: toSlug(j.name), tagline: j.tagline || '', color: sanitizeColor(j.color) })
    }
  } catch { /* fall through */ }

  // Last resort: a decent slug from the first meaningful noun, never the raw idea.
  const fallback = idea.replace(/^(i want to build|build|create|make|a|an|the)\s+/gi, '').split(/\s+/)[0] || 'app'
  const name = fallback.charAt(0).toUpperCase() + fallback.slice(1)
  return Response.json({ name, slug: toSlug(name), tagline: '', color: '#2f6d86' })
}

function sanitizeColor(c: unknown): string {
  const s = String(c || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : '#2f6d86'
}
