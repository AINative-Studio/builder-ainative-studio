/**
 * Shared Claude-family completion resolver for the builder pivot (#207).
 *
 * Both the codegen route (app/api/chat-ws) and the pivot artifact route
 * (app/api/build/artifact) need the SAME provider resolution — Amazon Bedrock
 * (Config C) when enabled, else the direct Anthropic API — so this centralizes
 * it. Returns a client whose `.messages.create()` surface is provider-agnostic.
 *
 * This is a completion helper, NOT the codegen system prompt. The pivot's
 * artifacts are PROSE (venture thesis, wedge, business model), so callers pass
 * their own artifact-specific system prompt — never the React-component prompt.
 */

import { getBedrockClient, isBedrockEnabled } from '@/lib/bedrock-client'

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929'

function anthropicDirect(): { client: any; model: string } | null {
  const key = process.env.ANTHROPIC_API_KEY
  if (!(key && key.startsWith('sk-ant-'))) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')
    return { client: new Anthropic({ apiKey: key }), model: CLAUDE_MODEL }
  } catch {
    return null
  }
}

export interface ClaudeCompletion {
  client: any
  provider: 'bedrock' | 'anthropic'
  model: string
  label: string
}

/**
 * Resolve the primary Claude completion client (Bedrock first, then direct
 * Anthropic). Returns null when neither is configured — callers must handle it
 * (the pivot surfaces a clear "generation unavailable" state rather than faking
 * content).
 */
export function getClaudeCompletion(): ClaudeCompletion | null {
  if (isBedrockEnabled()) {
    const bedrock = getBedrockClient()
    if (bedrock) {
      return { client: bedrock, provider: 'bedrock', model: bedrock.modelId, label: 'Claude Sonnet 4.5 (Amazon Bedrock)' }
    }
  }
  const direct = anthropicDirect()
  if (direct) {
    return { client: direct.client, provider: 'anthropic', model: direct.model, label: 'Claude Sonnet 4.5' }
  }
  return null
}

/**
 * One-shot text completion via the resolved Claude client. Returns the joined
 * text of all text blocks. Throws if no Claude path is configured (caller
 * decides how to surface it).
 */
export async function completeText(opts: {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
}): Promise<{ text: string; provider: string; model: string; usage?: { input_tokens: number; output_tokens: number } }> {
  const c = getClaudeCompletion()
  if (!c) {
    throw new Error('NO_CLAUDE_PROVIDER')
  }
  const res = await c.client.messages.create({
    model: c.model,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.6,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  })
  const text = (res.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()
  return { text, provider: c.provider, model: c.model, usage: res.usage }
}
