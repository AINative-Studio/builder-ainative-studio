/**
 * /api/build/help (#60) — the AI "Ask anything" backend for the Help Center.
 *
 * Answers user (and agent) questions about Builder/AINative, GROUNDED in a
 * curated FAQ knowledge base (RAG). The flow:
 *   1. Retrieve the most relevant FAQ entries for the question (pure, local).
 *   2. Feed those entries to Claude as grounding context via the shared
 *      completeText helper (Bedrock → Anthropic), with an AINative-hosted model
 *      as a fallback so the box degrades gracefully.
 *   3. Return the answer + the FAQ entries used as `sources` (citations).
 *
 * This is intentionally the SAME endpoint humans and agents hit — it is the AX
 * surface for Builder help (issue #60, acceptance: "agent-queryable").
 *
 * POST body: { question: string }
 * POST returns: { answer, sources: [{ id, question }], model, provider }
 *
 * This route is on the public allowlist (middleware.ts: /api/build/*) so the
 * Help Center works for anonymous visitors.
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { getClaudeCompletion } from '@/lib/build/claude-completion'
import {
  retrieveFaq,
  buildGroundingContext,
  buildHelpSystemPrompt,
  type FaqEntry,
} from '@/lib/build/help-faq'
import {
  isCapabilityQuestion,
  retrieveCapabilities,
  capabilitiesGroundingBlock,
} from '@/lib/build/capabilities'

export const runtime = 'nodejs'

const ainative = new OpenAI({
  apiKey:
    process.env.AINATIVE_API_KEY ||
    process.env.API_Key ||
    process.env.ZERODB_API_KEY ||
    '',
  baseURL: (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1',
})

const AINATIVE_FALLBACK_MODEL = process.env.AINATIVE_HELP_MODEL || 'nous-coder'

/** Build the grounded system prompt for a set of retrieved FAQ entries. */

/** Map retrieved entries to lightweight citation objects for the response. */
function toSources(entries: FaqEntry[]) {
  return entries.map((e) => ({ id: e.id, question: e.question }))
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const question = String(body?.question || '').trim().slice(0, 2000)
  if (!question) {
    return Response.json({ error: 'question required' }, { status: 400 })
  }

  // 1. Retrieve grounding (pure, local, always available).
  // #316/#313: for a "what can I build" intent, ground with the PLAIN-ENGLISH
  // capabilities catalog (primitive → what you build → replaces X → included), NOT
  // the API reference. This is the exact bug — discovery surfaced the raw API ref
  // instead of a capabilities overview. Blend capabilities + FAQ so the answer
  // educates on what's possible and cites the capabilities used.
  const isCapQ = isCapabilityQuestion(question)
  const entries = retrieveFaq(question, isCapQ ? 2 : 4)
  const caps = isCapQ ? retrieveCapabilities(question, 8) : []
  const context = isCapQ
    ? capabilitiesGroundingBlock(caps) + '\n\n' + buildGroundingContext(entries)
    : buildGroundingContext(entries)
  const sources = isCapQ
    ? [
        ...caps.map((c) => ({ id: `cap:${c.product}`, question: `${c.product} — ${c.build}` })),
        ...toSources(entries),
      ]
    : toSources(entries)
  const system = buildHelpSystemPrompt(context)

  // 2. Primary: Claude (Bedrock → Anthropic) grounded in the FAQ context.
  const claude = getClaudeCompletion()
  if (claude) {
    try {
      const res = await claude.client.messages.create({
        model: claude.model,
        max_tokens: 500,
        temperature: 0.4,
        system,
        messages: [{ role: 'user', content: question }],
      })
      const answer = (res.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim()
      if (answer) {
        return Response.json({ answer, sources, provider: claude.provider, model: claude.model })
      }
    } catch (e: any) {
      console.warn(`[build/help] ${claude.provider} failed: ${e?.message?.slice(0, 80)}`)
    }
  }

  // 3. Fallback: AINative-hosted chat completion, same grounding.
  try {
    const res = await ainative.chat.completions.create({
      model: AINATIVE_FALLBACK_MODEL,
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: question },
      ],
    })
    const answer = res.choices?.[0]?.message?.content?.trim()
    if (answer) {
      return Response.json({ answer, sources, provider: 'ainative', model: AINATIVE_FALLBACK_MODEL })
    }
  } catch (e: any) {
    console.warn(`[build/help] ainative failed: ${e?.message?.slice(0, 80)}`)
  }

  // 4. Last resort: no model reachable. Return the top grounded FAQ answer
  // directly so the user still gets a real, factual response (never a 500).
  const top = entries[0]
  if (top) {
    return Response.json({
      answer: top.answer,
      sources,
      provider: 'faq',
      model: 'curated-faq',
    })
  }
  return Response.json({ error: 'unavailable' }, { status: 503 })
}
