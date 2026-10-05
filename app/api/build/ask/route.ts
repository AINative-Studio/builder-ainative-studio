/**
 * POST /api/build/ask (#207 · B2, #287, #288, #52) — the "Ask Cody anything" chat
 * on the Live dashboard.
 *
 * Improvements:
 *  #288 — system prompt now uses the company's ACTUAL selected primitives from
 *          the catalog (via catalogPromptBlock) instead of a hardcoded list.
 *  #287 — Cody knows what's live vs queued, can explain the conversion gate, and
 *          names 3-5 concrete backlog items for THIS company — not invented ones.
 *  #52  — the conversation is now PERSISTED (ZeroDB builder_build_chat) and Cody
 *          has MEMORY: POST loads recent history and feeds it to the model, then
 *          persists the new user+cody turns. GET returns the prior thread so the
 *          Live dashboard rehydrates on mount (survives reload / re-login).
 *
 * Body: { question, idea, companyName?, track?, companyId?, guestId? }
 * Returns: { answer, model, provider }
 * GET  ?slug=&guestId= → { turns: [{ role, text }] } — the persisted conversation.
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { getClaudeCompletion } from '@/lib/build/claude-completion'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { modelsForTier } from '@/lib/build/tier-models'
import { selectPrimitives, catalogPromptBlock } from '@/lib/build/primitive-catalog'
import { chatKey, loadConversation, appendExchange, toMessages } from '@/lib/build/chat-store'

export const runtime = 'nodejs'

/**
 * Resolve the conversation OWNER for persistence (#52): the signed-in user's email
 * (real, durable cross-device identity once auth #49 lands) if present, else the
 * caller-supplied guest session id (survives reload for an anonymous founder). We
 * NEVER trust a body-supplied email — the authed identity comes from the server
 * session only. Returns '' when we have neither (chat degrades to in-memory).
 */
async function resolveOwner(guestId: string): Promise<string> {
  try {
    const session = await auth()
    const email = (session as any)?.user?.email as string | undefined
    const type = (session as any)?.user?.type as string | undefined
    if (email && type !== 'guest') return email
  } catch {
    /* fall through to guest */
  }
  return String(guestId || '').trim()
}

const ainative = new OpenAI({
  apiKey: process.env.AINATIVE_API_KEY || process.env.API_Key || process.env.ZERODB_API_KEY || '',
  baseURL: (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1',
})

async function resolveTier(): Promise<string> {
  try {
    const session = await auth()
    const accessToken = (session as any)?.accessToken
    if (!accessToken) return 'hobbyist'
    return (await getPlanStatus(accessToken)).tier || 'hobbyist'
  } catch {
    return 'hobbyist'
  }
}

/** Fetch a compact backlog summary for this company to ground Cody's answers. */
async function fetchBacklogSummary(companyId: string, idea: string, companyName: string, track: string): Promise<string> {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
    const url = new URL('/api/build/backlog', base)
    url.searchParams.set('companyId', companyId)
    url.searchParams.set('idea', idea)
    url.searchParams.set('companyName', companyName)
    url.searchParams.set('track', track)
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return ''
    const d = await r.json().catch(() => null)
    if (!d) return ''

    const builtNames = d.built?.map((b: any) => b.title).join('; ') || ''
    const queuedNames = (d.queued || []).slice(0, 5).map((q: any) => q.title).join('; ')
    return (
      `COMPANY BACKLOG:\n` +
      `Built & live now: ${builtNames}\n` +
      `Queued (requires plan/domain): ${queuedNames}\n` +
      `Conversion gate: ${d.gate || ''}`
    )
  } catch {
    return ''
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const question = String(body?.question || '').trim()
  if (!question) return Response.json({ error: 'question required' }, { status: 400 })

  const idea = String(body?.idea || '').slice(0, 3000)
  const companyName = String(body?.companyName || 'the company').slice(0, 120)
  const track = body?.track === 'app' ? 'app' : 'company'
  const companyId = String(body?.companyId || '').slice(0, 80)
  const guestId = String(body?.guestId || '').slice(0, 120)

  // #52 — the conversation key + prior history. Best-effort: if we can't resolve an
  // owner or the load fails, `key` is '' and `history` is [] — Cody answers exactly
  // as before (no memory, no persistence), so this is never a regression.
  const key = chatKey(await resolveOwner(guestId), companyId)
  const history = key ? await loadConversation(key).catch(() => []) : []

  // Get the actual primitives selected for this company's idea
  const { names: primitiveNames } = selectPrimitives(idea, track)
  const primList = primitiveNames.join(', ')

  // Fetch backlog so Cody can cite real items (not invented ones)
  const backlogBlock = companyId
    ? await fetchBacklogSummary(companyId, idea, companyName, track)
    : ''

  // Build the catalog block for context
  const catalogBlock = catalogPromptBlock(idea, track)

  const system =
    `You are Cody, the AI co-founder who just built and now operates "${companyName}", ` +
    `an AI-native ${track === 'app' ? 'product' : 'company'} built on AINative primitives.\n\n` +
    `The founder's idea: "${idea}".\n\n` +
    `This company's selected primitives (what is actually wired for this idea, not a generic list): ${primList}.\n\n` +
    `${catalogBlock}\n\n` +
    (backlogBlock ? `${backlogBlock}\n\n` : '') +
    `INSTRUCTIONS:\n` +
    `- Answer the founder's question directly, concretely, and in first person as Cody.\n` +
    `- Be specific to THIS company and THIS idea — not generic AI advice.\n` +
    `- If they ask about status, what's next, or why things aren't working yet:\n` +
    `  (a) Say what IS live now (the frontend preview + foundational primitives above).\n` +
    `  (b) Frame the conversion gate clearly: "Once you buy a domain + start a subscription, ` +
    `I build the real backend and wire [specific primitives from the backlog] for real."\n` +
    `  (c) Name 3-5 CONCRETE backlog items from the company backlog above — use the actual titles.\n` +
    `  (d) Do NOT promise free future feature work. The queued items are real but gated on a plan.\n` +
    `- Keep it to 2-4 sentences for simple questions; up to 6 sentences for status/next-steps questions.\n` +
    `- No fluff, no disclaimers. Run it 24/7 via the nightly autonomous loop.`

  const tier = modelsForTier(await resolveTier())

  // #52 — recent history so follow-ups ("make it cheaper", "and add auth") have
  // context. The current question is appended LAST so it's the turn being answered.
  const historyMessages = toMessages(history)
  const conversation = [...historyMessages, { role: 'user' as const, content: question }]

  // Persist the completed exchange after we have an answer (best-effort, never blocks
  // the response). Skipped when there's no key (unresolvable owner / degraded mode).
  const persist = (answer: string) => {
    if (key && answer) void appendExchange(key, question, answer)
  }

  const claude = getClaudeCompletion()
  if (claude) {
    const model = claude.provider === 'bedrock' ? tier.bedrockModel : claude.model
    try {
      const res = await claude.client.messages.create({
        model, max_tokens: 600, temperature: 0.7, system,
        messages: conversation,
      })
      const answer = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
      if (answer) { persist(answer); return Response.json({ answer, provider: claude.provider, model }) }
    } catch (e: any) {
      console.warn(`[build/ask] ${claude.provider} failed: ${e?.message?.slice(0, 80)}`)
    }
  }

  // Fallback: AINative chat-completions
  try {
    const res = await ainative.chat.completions.create({
      model: tier.ainativeModel, max_tokens: 600, temperature: 0.7,
      messages: [{ role: 'system', content: system }, ...conversation],
    })
    const answer = res.choices?.[0]?.message?.content?.trim()
    if (answer) { persist(answer); return Response.json({ answer, provider: 'ainative', model: tier.ainativeModel }) }
  } catch (e: any) {
    console.warn(`[build/ask] ainative failed: ${e?.message?.slice(0, 80)}`)
  }

  return Response.json({ error: 'unavailable' }, { status: 503 })
}

/**
 * GET /api/build/ask?slug=&guestId= (#52) — the persisted conversation for this
 * company + owner, oldest-first, so the Live dashboard rehydrates its chat on mount
 * (survives reload / re-login). Honest empty state ({ turns: [] }) for a brand-new
 * company or an unresolvable owner — never fabricated history.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const slug = String(params.get('slug') || '').slice(0, 80)
  const guestId = String(params.get('guestId') || '').slice(0, 120)
  const key = chatKey(await resolveOwner(guestId), slug)
  if (!key) return Response.json({ turns: [] })
  const turns = await loadConversation(key).catch(() => [])
  return Response.json({ turns: turns.map((t) => ({ role: t.role, text: t.text })) })
}
