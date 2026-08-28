/**
 * Committee model I/O adapter (builder#346).
 *
 * committee-gate.ts is pure + injects a `RunModel`. This module is the real
 * wiring: it routes a reviewer/chair model to an actual client, so the pure gate
 * stays fully unit-tested (this thin adapter is the only untested seam, by
 * design — it's the network boundary).
 *
 * Routing:
 *   - a `claude*` model name → the shared Claude completion path (Bedrock first,
 *     then direct Anthropic), reusing lib/build/claude-completion.
 *   - anything else → the AINative OpenAI-compatible chat-completions proxy,
 *     which fans out to Qwen / Gemini / etc. by model name — giving us the
 *     cross-VENDOR independence that makes agreement meaningful.
 *
 * Every call is time-boxed with AbortSignal.timeout so a hung vendor can never
 * hang the committee. On any failure it THROWS (the gate catches per-reviewer and
 * degrades to a failed review) — it never fabricates a review.
 */

import { completeText } from '@/lib/build/claude-completion'
import type { RunModel } from '@/lib/build/committee-gate'

/** AINative OpenAI-compatible base URL for non-Claude reviewers. */
const AINATIVE_BASE = process.env.AINATIVE_BASE_URL || 'https://api.ainative.studio/api/v1'

function ainativeToken(): string {
  return process.env.AINATIVE_API_TOKEN || process.env.AINATIVE_API_KEY || ''
}

/** Rough token estimate (chars/4) for cost accounting when the API omits usage. */
function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4)
}

/** Call a non-Claude model via the AINative OpenAI-compatible proxy. */
async function runViaAinative(args: {
  model: string
  system: string
  user: string
  timeoutMs: number
}): Promise<{ text: string; tokens?: number }> {
  const token = ainativeToken()
  if (!token) throw new Error('AINATIVE_API_TOKEN not configured')
  const res = await fetch(`${AINATIVE_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(args.timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`AINative proxy ${args.model} HTTP ${res.status}`)
  }
  const data: any = await res.json()
  const text = String(data?.choices?.[0]?.message?.content || '')
  const tokens =
    data?.usage?.total_tokens ?? estimateTokens(args.system + args.user + text)
  return { text, tokens }
}

/** Call a Claude-family model via the shared completion path (Bedrock/Anthropic). */
async function runViaClaude(args: {
  system: string
  user: string
  timeoutMs: number
}): Promise<{ text: string; tokens?: number }> {
  // completeText has no explicit timeout arg; wrap it in a race so a hung
  // provider still respects the committee's per-call budget.
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('claude call timed out')), args.timeoutMs),
  )
  const call = completeText({ system: args.system, user: args.user, maxTokens: 2048, temperature: 0.3 })
  const r = await Promise.race([call, timeout])
  const tokens =
    (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0) ||
    estimateTokens(args.system + args.user + r.text)
  return { text: r.text, tokens }
}

/**
 * The production RunModel: routes by model name. Claude names go through the
 * Claude path; everything else through the AINative proxy. Throws on failure so
 * the gate's per-reviewer try/catch degrades gracefully.
 */
export const runModelLive: RunModel = async (args) => {
  const name = args.model.toLowerCase()
  if (name.startsWith('claude') || name.includes('anthropic')) {
    return runViaClaude(args)
  }
  return runViaAinative(args)
}
