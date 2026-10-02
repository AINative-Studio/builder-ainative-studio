/**
 * Smoke test for the configured CLAUDE_MODEL (issue #887).
 *
 * Real past incident (see app/api/chat-ws/route.ts ~line 99-102): a hardcoded
 * Claude model ID 404'd against the live API and the route silently fell
 * through to a cheaper open-source fallback (gpt-oss-20b) while still being
 * logged/billed as if it were Claude. The fix at the time made the model ID
 * env-overridable via CLAUDE_MODEL, but nothing actually verified the
 * configured ID stays live — a *different* stale ID could reintroduce the
 * exact same silent-mislabel failure with nothing to catch it except another
 * live incident.
 *
 * This module makes the smallest possible real API call (max_tokens: 1)
 * against whichever Claude-family client Builder's chat-ws route would
 * actually use in production — Bedrock first (CODY_USE_BEDROCK=1 + bearer
 * token), then the direct Anthropic API (sk-ant- key) — mirroring the exact
 * precedence of getPrimaryClaudeClient() in app/api/chat-ws/route.ts. That
 * function itself is module-private to the route file (not exported), so
 * this re-derives the same resolution rather than importing it.
 */

import { getBedrockClient } from '@/lib/bedrock-client'

export type ClaudeSmokeTestProvider = 'bedrock' | 'anthropic' | 'none'

export interface ClaudeSmokeTestResult {
  ok: boolean
  provider: ClaudeSmokeTestProvider
  /** The model ID we asked for */
  requestedModel: string
  /** The model ID the API actually reports back, when available */
  respondedModel?: string
  /** Round-trip latency in ms for the probe call */
  latencyMs?: number
  error?: string
}

/** Same default/override precedence as CLAUDE_MODEL in app/api/chat-ws/route.ts. */
export function resolveClaudeModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929'
}

/** Same availability check as USE_CLAUDE_DIRECT in app/api/chat-ws/route.ts. */
function isDirectAnthropicConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.startsWith('sk-ant-'))
}

/**
 * Run the live smoke test. Never throws — failures are reported in the
 * returned result so callers (health route, CLI script) can decide how to
 * alert without a try/catch at every call site.
 */
export async function runClaudeModelSmokeTest(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClaudeSmokeTestResult> {
  const requestedModel = resolveClaudeModel(env)
  const start = Date.now()

  // Precedence mirrors getPrimaryClaudeClient(): Bedrock first, then direct
  // Anthropic API. Neither configured -> no Claude path exists to probe.
  // Gate on the explicit flag (not isBedrockEnabled(), which also requires
  // the bearer token) so a half-configured Bedrock env reports a specific,
  // actionable error instead of silently falling through to provider: 'none'.
  if (env.CODY_USE_BEDROCK === '1') {
    const bedrock = getBedrockClient(env)
    if (!bedrock) {
      return {
        ok: false,
        provider: 'bedrock',
        requestedModel,
        error: 'CODY_USE_BEDROCK=1 but Bedrock client failed to initialize (missing AWS_BEARER_TOKEN_BEDROCK bearer token)',
      }
    }
    try {
      const res = await bedrock.messages.create({
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      const latencyMs = Date.now() - start
      if (!Array.isArray(res.content)) {
        return {
          ok: false,
          provider: 'bedrock',
          requestedModel,
          latencyMs,
          error: 'Bedrock response missing expected content array',
        }
      }
      return {
        ok: true,
        provider: 'bedrock',
        requestedModel,
        respondedModel: res.model || bedrock.modelId,
        latencyMs,
      }
    } catch (e: any) {
      return {
        ok: false,
        provider: 'bedrock',
        requestedModel,
        latencyMs: Date.now() - start,
        error: e?.message || String(e),
      }
    }
  }

  if (isDirectAnthropicConfigured(env)) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 })
      const res = await client.messages.create({
        model: requestedModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      const latencyMs = Date.now() - start
      const respondedModel: string | undefined = res?.model
      // The exact failure mode from the original incident: the API silently
      // serves a different model than requested rather than 404ing outright.
      if (respondedModel && respondedModel !== requestedModel) {
        return {
          ok: false,
          provider: 'anthropic',
          requestedModel,
          respondedModel,
          latencyMs,
          error: `Model mismatch: requested "${requestedModel}" but API responded with "${respondedModel}"`,
        }
      }
      return {
        ok: true,
        provider: 'anthropic',
        requestedModel,
        respondedModel,
        latencyMs,
      }
    } catch (e: any) {
      return {
        ok: false,
        provider: 'anthropic',
        requestedModel,
        latencyMs: Date.now() - start,
        error: e?.message || String(e),
      }
    }
  }

  return {
    ok: false,
    provider: 'none',
    requestedModel,
    error: 'Neither Bedrock (CODY_USE_BEDROCK + AWS_BEARER_TOKEN_BEDROCK) nor direct Anthropic (ANTHROPIC_API_KEY) is configured',
  }
}
