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

/**
 * MCP tool wiring for the spawned agent (closes the gap in epic #296 item 3:
 * the epic shipped the MCP client + catalog but the AGENT never received a
 * single MCP server — its tools were only Write/Edit).
 *
 * REALITY CHECK (2026-08-27): the catalog's hosted HTTP fleet
 * (mcp.ainative.studio/*) does not exist — that hostname is swallowed by the
 * builder's own wildcard-subdomain routing. The REAL AINative MCP servers are
 * STDIO npm packages; the flagship is `ainative-zerodb-mcp-server` (the
 * 69-tool ZeroDB surface), installed as a direct dependency so the spawn is
 * warm on Railway. The agent gets it via a Claude-Code-compatible stdio
 * --mcp-config, and `mcp__zerodb` extends allowedTools at the server level.
 *
 * REALITY CHECK (2026-09-05, builder#534 re-scope): the live per-instance MCP
 * HOSTING catalog (GET /api/v1/public/mcp/catalog — a DIFFERENT, working
 * system from the half-deployed shared gateway tracked in core#6953) lists 21
 * real servers. Two more are safely wireable here with env vars this repo
 * already has, same fail-closed bar as ZeroDB:
 *   - `@ainative/browser-mcp` (npm, real, 1.1.3): Browser Agent's own MCP
 *     server. Verified by inspecting the published tarball directly — its
 *     `BROWSER_TOOLS` array (src/tools/browser-tools.js) names 8 real tools
 *     (browser_act, browser_extract, browser_validate, browser_task,
 *     browser_extract_to_table, browser_enrich_memory, browser_batch_extract,
 *     browser_enrich_memory_async), NOT the "6 tools" the package's own
 *     header comment/README claim (stale doc, real array is the source of
 *     truth). It also reads `AINATIVE_API_KEY`/`AINATIVE_API_URL` (optionally
 *     `AINATIVE_USERNAME`/`AINATIVE_PASSWORD`) — the catalog's
 *     `config_template` for this entry (ZERODB_API_KEY/ZERODB_PROJECT_ID) is
 *     WRONG/stale; wiring follows the package's real client code
 *     (src/client/browser-client.js), not the catalog template.
 *   - `zerodb-sequential-thinking-mcp` (npm, real, 0.1.1): persistent
 *     chain-of-thought reasoning. Tool names verified from its own
 *     src/tools.js: sequential_think, sequential_conclude, sequential_resume.
 *     Reads ZERODB_API_KEY/ZERODB_BASE_URL/ZERODB_PROJECT_ID as documented —
 *     it self-provisions a ZeroDB account when they're absent, but we only
 *     wire it here when a real key is already present (same bar as the rest).
 * `ainative-strapi-mcp` is NOT wired: its catalog entry requires a
 * per-company STRAPI_URL/STRAPI_TOKEN this repo has no provisioning story for
 * (same gap as ZeroVoice hit earlier) — deferred, not silently skipped.
 *
 * REALITY CHECK (2026-09-05, builder#555): `@ainative/zeropipeline-mcp` was
 * investigated for the same treatment and is NOT wired — verified live via
 * `npm view`/`npm pack` + extracting the real published tarball, not the
 * issue's claims. Findings that broke the premise:
 *   - The real published version is 0.1.0 (issue claimed 0.2.0).
 *   - The npm package ships NO Node MCP server at all — its entire contents
 *     are `bin/cli.mjs`, a shim that `which`-locates a `zeropipeline-mcp`
 *     binary or shells out to `python3 -m zeropipeline_mcp`. Its own README
 *     says so outright: "thin Node.js shim that spawns the Python
 *     zeropipeline-mcp process ... No Node.js runtime dependencies needed —
 *     it delegates to the Python server." There is no `index.js`/Node entry
 *     file this repo's `existsSync(node_modules/<pkg>/<entryFile>)` +
 *     `command: process.execPath, args: [serverEntry]` spawn contract (see
 *     buildAgentMcpWiring below) can ever satisfy honestly — the real 41-tool
 *     implementation lives entirely in the SEPARATE PyPI package
 *     `zeropipeline-mcp` (Python 3.10+, FastMCP, `zeropipeline_mcp/server.py`
 *     — verified by downloading and reading the actual wheel), and the tool
 *     count itself is 41, not the issue's "30" (includes bulk_create_customers,
 *     bulk_tag_customers, update_customer, get_tag_coverage, enrich_customer,
 *     and 3 luma_* tools the issue's summary omitted entirely).
 *   - This repo (builder-ainative-studio) is Node/Next.js only — no
 *     Dockerfile, no requirements.txt/Pipfile, no Python runtime anywhere in
 *     the deploy path (railway.json is a Node/nixpacks build). There is no
 *     provisioning story for a Python 3.10+ interpreter on the Railway
 *     container, so even installing the npm shim would `existsSync`-pass on
 *     `bin/cli.mjs` while failing at spawn time on every real invocation —
 *     the exact fail-OPEN failure mode (a tool that appears wired but errors
 *     on every call) this file's safety bar exists to prevent, just moved
 *     from account-provisioning risk (the issue's own stated concern) to
 *     process-spawn risk.
 * Deferred, not silently skipped: wire it if/when a real Node-native MCP
 * server ships for ZeroPipeline (matching the ZeroDB/Browser Agent/Sequential
 * Thinking shape), or once this repo has an actual Python runtime story.
 *

 * Every server below shares one safety bar: env-gated (real key present),
 * existence-checked (`existsSync` on the installed package's real entry file
 * — a missing package fails closed, never throws), and additive to
 * `allowedTools` only when actually wired. A single kill switch
 * (CODY_AGENT_MCP=0) disables ALL servers at once for parity with the
 * pre-existing behavior.
 */

/** One STDIO MCP server this repo can wire into the spawned agent. */
interface McpServerSpec {
  /** Key under `mcpServers` in the --mcp-config JSON, and the allowedTools name (`mcp__<name>`). */
  name: string
  /** npm package name as installed in node_modules. */
  pkg: string
  /** Entry file relative to the package root (its `main`/`bin` target). */
  entryFile: string
  /** Env vars to pass to the spawned server process. Return null to skip wiring (e.g. missing required key). */
  buildEnv: (env: NodeJS.ProcessEnv) => Record<string, string> | null
}

const MCP_SERVER_SPECS: McpServerSpec[] = [
  {
    name: 'zerodb',
    pkg: 'ainative-zerodb-mcp-server',
    entryFile: 'index.js',
    buildEnv: (env) => {
      const key = env.ZERODB_API_KEY || env.AINATIVE_API_KEY || ''
      if (!key) return null
      return {
        ZERODB_API_KEY: key,
        ZERODB_API_URL: env.ZERODB_API_URL || 'https://api.ainative.studio',
        ...(env.ZERODB_PROJECT_ID ? { ZERODB_PROJECT_ID: env.ZERODB_PROJECT_ID } : {}),
      }
    },
  },
  {
    name: 'browser-agent',
    pkg: '@ainative/browser-mcp',
    entryFile: 'index.js',
    // Real env contract per the package's own client code (AINATIVE_*, not
    // the catalog's stale ZERODB_* template) — see the REALITY CHECK above.
    buildEnv: (env) => {
      const key = env.AINATIVE_API_KEY || env.ZERODB_API_KEY || ''
      if (!key) return null
      return {
        AINATIVE_API_KEY: key,
        AINATIVE_API_URL: env.AINATIVE_API_URL || 'https://api.ainative.studio',
      }
    },
  },
  {
    name: 'sequential-thinking',
    pkg: 'zerodb-sequential-thinking-mcp',
    entryFile: 'index.js',
    buildEnv: (env) => {
      const key = env.ZERODB_API_KEY || env.AINATIVE_API_KEY || ''
      if (!key) return null
      return {
        ZERODB_API_KEY: key,
        ZERODB_BASE_URL: env.ZERODB_BASE_URL || env.ZERODB_API_URL || 'https://api.ainative.studio',
        ...(env.ZERODB_PROJECT_ID ? { ZERODB_PROJECT_ID: env.ZERODB_PROJECT_ID } : {}),
      }
    },
  },
]

/**
 * Gated OFF only by CODY_AGENT_MCP=0; each server is independently inert
 * (skipped, never throws) when its package isn't installed or its required
 * env vars are absent. Returns configJson: null only when NO server wired.
 */
export function buildAgentMcpWiring(env: NodeJS.ProcessEnv = process.env): {
  configJson: string | null
  allowedTools: string[]
} {
  if ((env.CODY_AGENT_MCP || '').trim() === '0') return { configJson: null, allowedTools: [] }

  const mcpServers: Record<string, unknown> = {}
  const allowedTools: string[] = []

  for (const spec of MCP_SERVER_SPECS) {
    const serverEnv = spec.buildEnv(env)
    if (!serverEnv) continue // required key absent — skip this server, keep checking others
    const serverEntry = join(process.cwd(), 'node_modules', spec.pkg, spec.entryFile)
    if (!existsSync(serverEntry)) continue // package not installed — fail closed for this server only
    mcpServers[spec.name] = {
      type: 'stdio',
      command: process.execPath, // the running node binary — no PATH lookup
      args: [serverEntry],
      env: serverEnv,
    }
    allowedTools.push(`mcp__${spec.name}`)
  }

  if (allowedTools.length === 0) return { configJson: null, allowedTools: [] }
  return { configJson: JSON.stringify({ mcpServers }), allowedTools }
}
