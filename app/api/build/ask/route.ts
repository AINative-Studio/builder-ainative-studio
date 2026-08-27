/**
 * /api/build/ask (#207 · B2, #287, #288, #52) — the "Ask Cody anything" chat on
 * the Live dashboard.
 *
 * Improvements:
 *  #288 — system prompt now uses the company's ACTUAL selected primitives from
 *          the catalog (via catalogPromptBlock) instead of a hardcoded list.
 *  #287 — Cody knows what's live vs queued, can explain the conversion gate, and
 *          names 3-5 concrete backlog items for THIS company — not invented ones.
 *  #52  — the conversation is now PERSISTENT and Cody has MEMORY. Each turn
 *          (user + Cody) is written to ZeroDB, scoped per {owner, company}, and
 *          the last N turns are fed to Claude so follow-ups have context. A GET
 *          on this route rehydrates the thread on mount, so reload/re-login
 *          restores exactly where the founder left off.
 *
 * POST body: { question, idea, companyName?, track?, companyId?, chatId? }
 * POST returns: { answer, model, provider }
 * GET  ?companyId=…&chatId=…  returns: { turns: [{ role, text, createdAt }] }
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { getClaudeCompletion } from '@/lib/build/claude-completion'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { resolveActivePlan } from '@/lib/ainative/active-plan'
import { modelsForTier } from '@/lib/build/tier-models'
import { selectPrimitives, catalogPromptBlock } from '@/lib/build/primitive-catalog'
import {
  deriveOwnerKey,
  chatScopeKey,
  loadChat,
  saveExchange,
  buildMessagesWithHistory,
} from '@/lib/build/chat-store'

export const runtime = 'nodejs'

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

/**
 * Resolve the durable conversation scope key for THIS request from the server
 * session (owner) + the company/chat identifier (never trusted from the body
 * for the owner half). Authenticated users key by email; guests key by their
 * stable guest session so the thread survives reload. Returns '' when there is
 * no company identifier to scope by (persistence/load are then skipped).
 */
async function resolveScopeKey(companyId: string): Promise<string> {
  const slug = String(companyId || '').trim()
  if (!slug) return ''
  const session = await auth().catch(() => null)
  const ownerKey = deriveOwnerKey(session as any)
  return chatScopeKey(ownerKey, slug)
}

/** Fetch a compact backlog summary for this company to ground Cody's answers.
 *  Plan-aware: a PAID founder's queue is framed as work-in-queue (their plan
 *  covers it) — the conversion-gate line is only included for free accounts. */
async function fetchBacklogSummary(companyId: string, idea: string, companyName: string, track: string, paid: boolean): Promise<string> {
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
      (paid
        ? `In the queue (covered by the founder's plan — next runs pick these up): ${queuedNames}`
        : `Queued (part of the paid build-out): ${queuedNames}\n` +
          `Conversion gate: ${d.gate || ''}`)
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
  // chatId wins over companyId as the scope identifier when present (#52) so a
  // company with multiple build threads keeps them distinct; falls back to slug.
  const companyId = String(body?.chatId || body?.companyId || '').slice(0, 80)

  // Resolve the persistent conversation scope (owner from session + company) and
  // load recent history so Cody has memory of the last few turns (#52).
  const scopeKey = await resolveScopeKey(companyId)
  const history = scopeKey ? await loadChat(scopeKey).catch(() => []) : []

  // Get the actual primitives selected for this company's idea
  const { names: primitiveNames } = selectPrimitives(idea, track)
  const primList = primitiveNames.join(', ')

  // Plan-aware voice (Greg Rose feedback 2026-08-27): resolve the account's real
  // plan BEFORE building the prompt/backlog framing — see gateInstructions below.
  const { plan: activePlan } = await resolveActivePlan().catch(() => ({ plan: '' as const }))
  const paid = Boolean(activePlan)

  // Fetch backlog so Cody can cite real items (not invented ones)
  const backlogBlock = companyId
    ? await fetchBacklogSummary(companyId, idea, companyName, track, paid)
    : ''

  // Build the catalog block for context
  const catalogBlock = catalogPromptBlock(idea, track)

  // Cody was scripted to pitch "buy a domain + subscription" to EVERY founder —
  // including paying Enterprise accounts, and including free founders who still
  // have build credits and CAN iterate right now. A paying founder is never
  // pitched; a free founder is told what they can do NOW for free first.
  const gateInstructions = paid
    ? `- The founder is on a PAID AINative plan (${activePlan}) — their plan already covers the build-out. ` +
      `NEVER pitch a subscription, plan, or purchase, and never say work is "gated". ` +
      `When they ask for a change or feature: confirm you're on it in first person ` +
      `("I'll wire that next — it's in the queue for tonight's run"), name the concrete backlog items ` +
      `it maps to, and point at the real levers they already have (Auto Mode, the nightly loop, ` +
      `regenerating the app from the workspace). A custom domain is OPTIONAL — mention it only if ` +
      `they ask about domains.\n`
    : `- The founder is on the FREE tier. They can still iterate NOW at no cost: updating and ` +
      `regenerating the app preview from the workspace uses their free build allowance — say so ` +
      `plainly when they ask for a change, and tell them to make the change from the workspace. ` +
      `Only the REAL backend build-out (production data wiring, 24/7 ops, custom domain) is part of ` +
      `a plan: frame that honestly as "when you're ready to make it real" — never imply a small ` +
      `edit requires payment. Do NOT promise free future backend feature work.\n`

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
    `  (b) Name 3-5 CONCRETE backlog items from the company backlog above — use the actual titles.\n` +
    gateInstructions +
    `- TRUTH CONSTRAINT: the preview IS a working interactive app with LIVE data persistence ` +
    `(create/read/update/delete and semantic search work in the sandbox through the platform data ` +
    `layer). NEVER claim data persistence, interactivity, or the data layer are "not live yet" or ` +
    `"only come with a plan" — that is false and destroys trust. What a plan actually adds: own ` +
    `domain, real user authentication, production backend hardening, and 24/7 autonomous ops.\n` +
    `- PLAIN TEXT ONLY: no markdown, no asterisks, no headers — this chat renders raw text.\n` +
    `- Keep it to 2-4 sentences for simple questions; up to 6 sentences for status/next-steps questions.\n` +
    `- No fluff, no disclaimers. Run it 24/7 via the nightly autonomous loop.`

  const tier = modelsForTier(await resolveTier())

  // Conversation window: prior turns + the current question, so follow-ups
  // ("make it cheaper", "and add auth") resolve against real context (#52).
  const messages = buildMessagesWithHistory(history, question)

  /** Persist the completed exchange (best-effort; never blocks the response). */
  const persist = (answer: string) => {
    if (scopeKey && answer) void saveExchange(scopeKey, question, answer)
  }

  const claude = getClaudeCompletion()
  if (claude) {
    const model = claude.provider === 'bedrock' ? tier.bedrockModel : claude.model
    try {
      const res = await claude.client.messages.create({
        model, max_tokens: 600, temperature: 0.7, system,
        messages,
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
      messages: [{ role: 'system', content: system }, ...messages],
    })
    const answer = res.choices?.[0]?.message?.content?.trim()
    if (answer) { persist(answer); return Response.json({ answer, provider: 'ainative', model: tier.ainativeModel }) }
  } catch (e: any) {
    console.warn(`[build/ask] ainative failed: ${e?.message?.slice(0, 80)}`)
  }

  return Response.json({ error: 'unavailable' }, { status: 503 })
}

/**
 * GET /api/build/ask?companyId=…&chatId=… (#52) — rehydrate the persisted Cody
 * conversation for the current owner + company, oldest-first. Returns an honest
 * empty list for a brand-new company (no fabricated history). Never 500s: on any
 * failure it yields an empty thread so the dashboard still renders.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const companyId = String(params.get('chatId') || params.get('companyId') || '').slice(0, 80)
  const scopeKey = await resolveScopeKey(companyId)
  if (!scopeKey) return Response.json({ turns: [] })
  const turns = await loadChat(scopeKey).catch(() => [])
  return Response.json({ turns })
}
