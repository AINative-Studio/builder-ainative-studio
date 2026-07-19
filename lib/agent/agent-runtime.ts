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
export function getAgentSpawnEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const runtime = getAgentRuntime(env)
  const overrides: Record<string, string> = {}
  if (runtime === 'cody') {
    // cody-cli defaults to https://api.ainative.studio; make it explicit so the
    // builder's ANTHROPIC_BASE_URL (if set for Claude) doesn't leak into cody.
    overrides.ANTHROPIC_BASE_URL =
      env.AINATIVE_API_URL || env.CODY_BASE_URL || 'https://api.ainative.studio'
    const key = env.AINATIVE_API_KEY || env.ANTHROPIC_API_KEY || env.ZERODB_API_KEY
    if (key) overrides.ANTHROPIC_API_KEY = key
  }
  return overrides
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
