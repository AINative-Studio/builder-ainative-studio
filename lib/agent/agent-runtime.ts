/**
 * Agent runtime selection (builder#79).
 *
 * The headless agent spawns a Claude-Code-compatible CLI with
 * `--output-format stream-json`. Two runtimes speak that protocol:
 *   - `claude`  — Anthropic's Claude Code binary (external dependency)
 *   - `cody`    — @ainative/cody-cli, AINative's own harness (defaults to
 *                 api.ainative.studio, no external Anthropic dependency)
 *
 * `AGENT_RUNTIME=cody|claude` selects the binary. Default is `claude` for
 * backward compatibility; set `AGENT_RUNTIME=cody` to use the AINative harness.
 */

import { existsSync } from 'fs'
import { join } from 'path'

export type AgentRuntime = 'cody' | 'claude'

/** Resolve the configured agent runtime from the environment. */
export function getAgentRuntime(env: NodeJS.ProcessEnv = process.env): AgentRuntime {
  const raw = (env.AGENT_RUNTIME || '').trim().toLowerCase()
  return raw === 'cody' ? 'cody' : 'claude'
}

/**
 * The binary to spawn for the configured runtime. For cody we prefer the locally
 * installed CLI (node_modules/.bin/cody) so it works on a Railway container
 * where the binary isn't on the global PATH; falls back to the bare name for
 * dev machines where it's globally installed. `claude` stays a PATH lookup.
 */
export function getAgentBinary(env: NodeJS.ProcessEnv = process.env): string {
  if (getAgentRuntime(env) === 'cody') {
    const localBin = join(process.cwd(), 'node_modules', '.bin', 'cody')
    return existsSync(localBin) ? localBin : 'cody'
  }
  return 'claude'
}

/**
 * The environment overrides to pass to the spawned agent. For cody we ensure it
 * points at AINative inference (it already defaults there, but we make it
 * explicit and pass the AINative key through as the ANTHROPIC_API_KEY the
 * Claude-compatible CLI expects).
 */
/** Config C: cody's Bedrock provider is active (provider routing fixed in
 *  cody-cli#351). When on, the agent must NOT be pointed at the AINative
 *  chat proxy — Bedrock env (CODY_USE_BEDROCK, AWS_BEARER_TOKEN_BEDROCK,
 *  BEDROCK_MODEL_ID) flows through the process.env spread. */
export function isCodyBedrock(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CODY_USE_BEDROCK || '').trim() === '1'
}

export function getAgentSpawnEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const runtime = getAgentRuntime(env)
  const overrides: Record<string, string> = {}
  if (runtime === 'cody') {
    // Config C (CODY_USE_BEDROCK=1): let cody's OWN Bedrock provider route the
    // call — overriding ANTHROPIC_BASE_URL/KEY here pointed it at the AINative
    // chat proxy, which 400s on the mapped model ("model identifier is
    // invalid", builder#239): the agent NEVER ran on prod and no tool-using
    // trajectories were captured.
    if (isCodyBedrock(env)) return overrides
    // AINative-proxy mode: cody-cli defaults to https://api.ainative.studio;
    // make it explicit so the builder's ANTHROPIC_BASE_URL (if set for Claude)
    // doesn't leak into cody.
    overrides.ANTHROPIC_BASE_URL =
      env.AINATIVE_API_URL || env.CODY_BASE_URL || 'https://api.ainative.studio'
    const key = env.AINATIVE_API_KEY || env.ANTHROPIC_API_KEY || env.ZERODB_API_KEY
    if (key) overrides.ANTHROPIC_API_KEY = key
  }
  return overrides
}

/**
 * Resolve the model name to pass to the agent CLI for the active runtime.
 *
 * The builder defaults the agent model to Claude-Code shorthands like `sonnet`
 * / `opus`. Those work for the `claude` binary, but Cody routes to the AINative
 * proxy, whose enterprise tier rejects `sonnet` (403 permission_error) — every
 * such run then falls back to standard generation and NO Cody trajectory is
 * captured. For the cody runtime we map Anthropic-family shorthands to an
 * AINative-valid coding model (default `kimi-k2.6`, override via CODY_MODEL).
 * NOTE: `kimi-k2` (no minor) is REJECTED by the AINative proxy with HTTP 400
 * "model identifier is invalid" — using it forced a failed primary agent call on
 * every generation (only saved by the Bedrock fallback, adding latency + a
 * flaky-failure window). The valid identifier is `kimi-k2.6`.
 * Models already valid on AINative (e.g. `kimi-k2.6`, `qwen3-coder-flash`) pass
 * through unchanged. The `claude` runtime is untouched.
 */
const _ANTHROPIC_SHORTHANDS = new Set([
  'sonnet', 'opus', 'haiku',
  'claude-sonnet', 'claude-opus', 'claude-haiku', 'claude-opus-latest',
])

export function resolveAgentModel(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (getAgentRuntime(env) !== 'cody') return model
  // Config C: cody on Bedrock serves the Anthropic family directly — map
  // shorthands to the configured Bedrock model id, NOT to an AINative coding
  // model (kimi-k2.6 → 400 on the proxy; this bypassed the agent entirely).
  if (isCodyBedrock(env)) {
    const bedrockModel = (env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-6').trim()
    if (_ANTHROPIC_SHORTHANDS.has(model.trim().toLowerCase())) return bedrockModel
    return model
  }
  const codyDefault = (env.CODY_MODEL || 'kimi-k2.6').trim()
  // Only remap the Anthropic-family shorthands the AINative tier can't serve;
  // an explicit AINative model name (kimi-k2.6, qwen3-coder-flash, …) is honored.
  if (_ANTHROPIC_SHORTHANDS.has(model.trim().toLowerCase())) return codyDefault
  return model
}

/**
 * Whether the headless agent path is enabled at all. Enabled when either an
 * explicit flag is set (`USE_CLAUDE_AGENT`), or the runtime is `cody` (the
 * AINative harness is safe to use by default since it has no external cost/
 * dependency risk).
 */
export function isAgentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.USE_CLAUDE_AGENT === 'true') return true
  if (getAgentRuntime(env) === 'cody' && env.USE_CODY_AGENT !== 'false') return true
  return false
}

/**
 * Whether the agent may be used as a fallback when the fast path fails. Enabled
 * by `USE_CLAUDE_AGENT_FALLBACK`, `USE_CLAUDE_AGENT`, or the cody runtime.
 */
export function isAgentFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.USE_CLAUDE_AGENT_FALLBACK === 'true') return true
  return isAgentEnabled(env)
}
