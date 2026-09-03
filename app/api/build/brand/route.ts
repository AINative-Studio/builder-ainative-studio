/**
 * POST /api/build/brand (#207 · FIX-1) — generate a REAL brand for the idea.
 *
 * The old flow named the company from the first 3 words of the idea ("I Want To")
 * and slugged the raw idea into a garbage subdomain ("i-want-to-build-a-softwa").
 * This generates a proper brand: a real product name, a clean URL slug, a tagline,
 * and a brand accent color — all from the idea, via the tiered Claude stack.
 *
 * UNIQUENESS: the founder never types a literal name at this step (Intake only
 * ever collects an idea sentence) — every name from this route is LLM-invented,
 * so it must never propose one that's already registered to a DIFFERENT company.
 * Checks the real registry (resolveApp) before returning; on a collision, re-
 * prompts the SAME model with the taken name(s) explicitly excluded, up to
 * MAX_NAMING_ATTEMPTS real attempts, rather than mechanically suffixing a
 * number onto an otherwise-good name. A founder's own explicit rename
 * (CompanyNameEdit's inline edit, save()) never calls this route at all — that
 * path is intentionally never uniqueness-gated, since it's the founder's own
 * deliberate choice, not an LLM proposal.
 *
 * Body: { idea, track }
 * Returns: { name, slug, tagline, color }
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { getClaudeCompletion } from '@/lib/build/claude-completion'
import { resolveApp } from '@/lib/build/app-registry'

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

/** Real registry check — true only when a DIFFERENT, already-registered
 *  company holds this slug. Fail-open (false) on any lookup error, since a
 *  registry hiccup must never block naming a brand-new company. */
async function slugTaken(slug: string): Promise<boolean> {
  try {
    return Boolean(await resolveApp(slug))
  } catch {
    return false
  }
}

const MAX_NAMING_ATTEMPTS = 4

interface Brand { name: string; tagline: string; color: string }

/** One real model call. Returns null on any failure (bad response, network,
 *  no parseable JSON) so the caller can fall through to the next attempt/tier. */
async function proposeBrand(idea: string, avoidNames: string[]): Promise<Brand | null> {
  const avoidLine = avoidNames.length
    ? `\nThese names are ALREADY TAKEN by a different company — invent something genuinely different, not a variant or a number suffix: ${avoidNames.map((n) => `"${n}"`).join(', ')}.`
    : ''
  const user = `Product idea: """${idea}"""${avoidLine}\nInvent the brand. JSON: {"name","tagline","color"}`

  const claude = getClaudeCompletion()
  if (claude) {
    try {
      const res = await claude.client.messages.create({
        model: claude.model, max_tokens: 200, temperature: 0.9, system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      })
      const text = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      const j = parseJson(text)
      if (j?.name) return { name: j.name, tagline: j.tagline || '', color: sanitizeColor(j.color) }
    } catch { /* fall through to the AINative-proxied tier below */ }
  }

  try {
    const res = await ainative.chat.completions.create({
      model: 'claude-sonnet-4.5', max_tokens: 200, temperature: 0.9,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    })
    const j = parseJson(res.choices?.[0]?.message?.content || '')
    if (j?.name) return { name: j.name, tagline: j.tagline || '', color: sanitizeColor(j.color) }
  } catch { /* fall through — caller decides what happens on a null return */ }

  return null
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const idea = String(body?.idea || '').trim().slice(0, 2000)
  if (!idea) return Response.json({ error: 'idea required' }, { status: 400 })

  const avoidNames: string[] = []
  for (let attempt = 1; attempt <= MAX_NAMING_ATTEMPTS; attempt++) {
    const brand = await proposeBrand(idea, avoidNames)
    if (!brand) break // both model tiers failed outright — go to the last-resort fallback below
    const slug = toSlug(brand.name)
    if (!(await slugTaken(slug))) {
      return Response.json({ name: brand.name, slug, tagline: brand.tagline, color: brand.color })
    }
    // Real collision — tell the NEXT attempt to avoid this exact name too,
    // so repeated collisions don't just re-propose the same taken name.
    avoidNames.push(brand.name)
  }

  // Last resort: every real model attempt either failed outright or kept
  // colliding MAX_NAMING_ATTEMPTS times in a row (rare) — fall back to a
  // decent slug from the first meaningful noun, never the raw idea. Still
  // check it for a collision; if even THAT'S taken, this is the one place a
  // suffix is acceptable, since we've exhausted every real-naming attempt.
  const fallback = idea.replace(/^(i want to build|build|create|make|a|an|the)\s+/gi, '').split(/\s+/)[0] || 'app'
  const name = fallback.charAt(0).toUpperCase() + fallback.slice(1)
  let slug = toSlug(name)
  if (await slugTaken(slug)) {
    for (let n = 2; n <= 50; n++) {
      const candidate = `${slug}-${n}`
      if (!(await slugTaken(candidate))) { slug = candidate; break }
    }
  }
  return Response.json({ name, slug, tagline: '', color: '#2f6d86' })
}

function sanitizeColor(c: unknown): string {
  const s = String(c || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : '#2f6d86'
}
