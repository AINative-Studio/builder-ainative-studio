/**
 * POST /api/build/ask (#207 · B2) — the "Ask Cody anything" chat on the Live
 * dashboard, made real. Cody answers questions about the founder's specific
 * company using the same Claude completion stack (tiered by plan), grounded in
 * the idea + company name. No fake canned exchange.
 *
 * Body: { question, idea, companyName?, track? }
 * Returns: { answer, model, provider }
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { getClaudeCompletion } from '@/lib/build/claude-completion'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { modelsForTier } from '@/lib/build/tier-models'

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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const question = String(body?.question || '').trim()
  if (!question) return Response.json({ error: 'question required' }, { status: 400 })

  const idea = String(body?.idea || '').slice(0, 3000)
  const companyName = String(body?.companyName || 'the company').slice(0, 120)
  const track = body?.track === 'app' ? 'app' : 'company'

  const system =
    `You are Cody, the AI co-founder who just built and now operates "${companyName}", ` +
    `an AI-native ${track === 'app' ? 'product' : 'company'} built on AINative primitives ` +
    `(ZeroDB, ZeroMemory, Agent Cloud, ZeroPipeline, ZeroInvoice, etc). ` +
    `The founder's idea: "${idea}". You run it 24/7 via a nightly autonomous loop. ` +
    `Answer the founder's question directly, concretely, and in first person as Cody. ` +
    `Be specific to THIS company. Keep it to 2-4 sentences. If they ask what's next, ` +
    `recommend the single highest-leverage move. No fluff, no disclaimers.`

  const tier = modelsForTier(await resolveTier())

  const claude = getClaudeCompletion()
  if (claude) {
    const model = claude.provider === 'bedrock' ? tier.bedrockModel : claude.model
    try {
      const res = await claude.client.messages.create({
        model, max_tokens: 400, temperature: 0.7, system,
        messages: [{ role: 'user', content: question }],
      })
      const answer = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
      if (answer) return Response.json({ answer, provider: claude.provider, model })
    } catch (e: any) {
      console.warn(`[build/ask] ${claude.provider} failed: ${e?.message?.slice(0, 80)}`)
    }
  }

  // Fallback: AINative chat-completions
  try {
    const res = await ainative.chat.completions.create({
      model: tier.ainativeModel, max_tokens: 400, temperature: 0.7,
      messages: [{ role: 'system', content: system }, { role: 'user', content: question }],
    })
    const answer = res.choices?.[0]?.message?.content?.trim()
    if (answer) return Response.json({ answer, provider: 'ainative', model: tier.ainativeModel })
  } catch (e: any) {
    console.warn(`[build/ask] ainative failed: ${e?.message?.slice(0, 80)}`)
  }

  return Response.json({ error: 'unavailable' }, { status: 503 })
}
