import { describe, it, expect } from 'vitest'
import {
  getAgentRuntime,
  getAgentBinary,
  getAgentSpawnEnv,
  isAgentEnabled,
  isAgentFallbackEnabled,
  resolveAgentModel,
  buildAgentMcpWiring,
} from '@/lib/agent/agent-runtime'

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv

describe('agent-runtime (#79)', () => {
  describe('getAgentRuntime', () => {
    it('defaults to claude', () => {
      expect(getAgentRuntime(env({}))).toBe('claude')
    })
    it('returns cody when AGENT_RUNTIME=cody (case-insensitive, trimmed)', () => {
      expect(getAgentRuntime(env({ AGENT_RUNTIME: 'cody' }))).toBe('cody')
      expect(getAgentRuntime(env({ AGENT_RUNTIME: '  CODY ' }))).toBe('cody')
    })
    it('returns claude for any other value', () => {
      expect(getAgentRuntime(env({ AGENT_RUNTIME: 'gpt' }))).toBe('claude')
    })
  })

  describe('getAgentBinary', () => {
    it('resolves cody to the local bin path or the bare name', () => {
      const bin = getAgentBinary(env({ AGENT_RUNTIME: 'cody' }))
      // Either the resolved node_modules/.bin/cody path or the bare 'cody'
      expect(bin === 'cody' || bin.endsWith('/.bin/cody')).toBe(true)
    })
    it('maps claude to the bare binary name', () => {
      expect(getAgentBinary(env({}))).toBe('claude')
    })
  })

  describe('getAgentSpawnEnv', () => {
    it('returns no overrides for claude', () => {
      expect(getAgentSpawnEnv(env({}))).toEqual({})
    })
    it('points cody at AINative and passes the key through', () => {
      const out = getAgentSpawnEnv(env({ AGENT_RUNTIME: 'cody', AINATIVE_API_KEY: 'k-123' }))
      expect(out.ANTHROPIC_BASE_URL).toBe('https://api.ainative.studio')
      expect(out.ANTHROPIC_API_KEY).toBe('k-123')
    })
    it('honors AINATIVE_API_URL / CODY_BASE_URL override for cody', () => {
      expect(
        getAgentSpawnEnv(env({ AGENT_RUNTIME: 'cody', AINATIVE_API_URL: 'https://core.local' }))
          .ANTHROPIC_BASE_URL,
      ).toBe('https://core.local')
    })
    it('falls back through key sources', () => {
      expect(
        getAgentSpawnEnv(env({ AGENT_RUNTIME: 'cody', ZERODB_API_KEY: 'z' })).ANTHROPIC_API_KEY,
      ).toBe('z')
    })
    it('omits the key when none is set', () => {
      const out = getAgentSpawnEnv(env({ AGENT_RUNTIME: 'cody' }))
      expect(out.ANTHROPIC_API_KEY).toBeUndefined()
    })
  })

  describe('isAgentEnabled', () => {
    it('true when USE_CLAUDE_AGENT=true', () => {
      expect(isAgentEnabled(env({ USE_CLAUDE_AGENT: 'true' }))).toBe(true)
    })
    it('true for cody runtime by default', () => {
      expect(isAgentEnabled(env({ AGENT_RUNTIME: 'cody' }))).toBe(true)
    })
    it('false for cody when USE_CODY_AGENT=false', () => {
      expect(isAgentEnabled(env({ AGENT_RUNTIME: 'cody', USE_CODY_AGENT: 'false' }))).toBe(false)
    })
    it('false by default (claude runtime, no flag)', () => {
      expect(isAgentEnabled(env({}))).toBe(false)
    })
  })

  describe('isAgentFallbackEnabled', () => {
    it('true when USE_CLAUDE_AGENT_FALLBACK=true', () => {
      expect(isAgentFallbackEnabled(env({ USE_CLAUDE_AGENT_FALLBACK: 'true' }))).toBe(true)
    })
    it('true when the agent is enabled', () => {
      expect(isAgentFallbackEnabled(env({ AGENT_RUNTIME: 'cody' }))).toBe(true)
    })
    it('false by default', () => {
      expect(isAgentFallbackEnabled(env({}))).toBe(false)
    })
  })
})

describe('resolveAgentModel (builder#99 — cody model mapping)', () => {
  it('leaves the model unchanged for the claude runtime', () => {
    expect(resolveAgentModel('sonnet', env({}))).toBe('sonnet')
    expect(resolveAgentModel('sonnet', env({ AGENT_RUNTIME: 'claude' }))).toBe('sonnet')
  })

  // The default MUST be a model identifier the AINative proxy actually accepts.
  // `kimi-k2` (no minor) returns HTTP 400 "model identifier is invalid" in prod,
  // which forced a failed primary agent call on every generation. The valid
  // identifier is `kimi-k2.6` (see PAID_MODEL in chat-ws + model registry).
  it('maps anthropic shorthands to the cody default (kimi-k2.6) under the cody runtime', () => {
    const e = env({ AGENT_RUNTIME: 'cody' })
    expect(resolveAgentModel('sonnet', e)).toBe('kimi-k2.6')
    expect(resolveAgentModel('opus', e)).toBe('kimi-k2.6')
    expect(resolveAgentModel('claude-sonnet', e)).toBe('kimi-k2.6')
  })

  it('honors CODY_MODEL override', () => {
    const e = env({ AGENT_RUNTIME: 'cody', CODY_MODEL: 'qwen3-coder-flash' })
    expect(resolveAgentModel('sonnet', e)).toBe('qwen3-coder-flash')
  })

  it('passes through an explicit AINative model unchanged under cody', () => {
    const e = env({ AGENT_RUNTIME: 'cody' })
    expect(resolveAgentModel('kimi-k2.6', e)).toBe('kimi-k2.6')
    expect(resolveAgentModel('qwen3-coder-flash', e)).toBe('qwen3-coder-flash')
    expect(resolveAgentModel('deepseek-4-flash', e)).toBe('deepseek-4-flash')
  })

  it('is case-insensitive on the shorthand match', () => {
    const e = env({ AGENT_RUNTIME: 'cody' })
    expect(resolveAgentModel('Sonnet', e)).toBe('kimi-k2.6')
    expect(resolveAgentModel(' OPUS ', e)).toBe('kimi-k2.6')
  })
})

// builder#534 (re-scoped): buildAgentMcpWiring now wires THREE real, installed
// stdio MCP servers (ZeroDB, Browser Agent, Sequential Thinking), each
// independently env-gated + existence-checked + fail-closed. These tests run
// against the REAL installed packages in node_modules (ainative-zerodb-mcp-server,
// @ainative/browser-mcp, zerodb-sequential-thinking-mcp) — no fs mocking — so a
// green run here means the packages are actually present at the paths the
// wiring expects, not just that the gating logic is internally consistent.
describe('buildAgentMcpWiring (builder#534 — real multi-server MCP wiring)', () => {
  it('wires all three servers when a ZeroDB-family key is present and packages are installed', () => {
    const out = buildAgentMcpWiring(env({ ZERODB_API_KEY: 'zk-123' }))
    expect(out.configJson).not.toBeNull()
    expect(out.allowedTools.sort()).toEqual(
      ['mcp__browser-agent', 'mcp__sequential-thinking', 'mcp__zerodb'].sort(),
    )
    const parsed = JSON.parse(out.configJson as string)
    expect(Object.keys(parsed.mcpServers).sort()).toEqual(
      ['browser-agent', 'sequential-thinking', 'zerodb'].sort(),
    )
  })

  it('falls back through AINATIVE_API_KEY for all three servers', () => {
    const out = buildAgentMcpWiring(env({ AINATIVE_API_KEY: 'ak-123' }))
    expect(out.allowedTools.sort()).toEqual(
      ['mcp__browser-agent', 'mcp__sequential-thinking', 'mcp__zerodb'].sort(),
    )
  })

  it('is inert (no config, no tools) with no key at all — fails closed, never throws', () => {
    const out = buildAgentMcpWiring(env({}))
    expect(out.configJson).toBeNull()
    expect(out.allowedTools).toEqual([])
  })

  it('CODY_AGENT_MCP=0 disables ALL servers at once (single kill switch)', () => {
    const out = buildAgentMcpWiring(env({ ZERODB_API_KEY: 'zk-123', CODY_AGENT_MCP: '0' }))
    expect(out.configJson).toBeNull()
    expect(out.allowedTools).toEqual([])
  })

  it('zerodb server env includes ZERODB_API_URL default and passes through ZERODB_PROJECT_ID', () => {
    const out = buildAgentMcpWiring(
      env({ ZERODB_API_KEY: 'zk-123', ZERODB_PROJECT_ID: 'proj-1' }),
    )
    const parsed = JSON.parse(out.configJson as string)
    expect(parsed.mcpServers.zerodb.env).toEqual({
      ZERODB_API_KEY: 'zk-123',
      ZERODB_API_URL: 'https://api.ainative.studio',
      ZERODB_PROJECT_ID: 'proj-1',
    })
  })

  it('browser-agent server gets the AINATIVE_* env contract, not the catalog\'s stale ZERODB_* template', () => {
    const out = buildAgentMcpWiring(env({ ZERODB_API_KEY: 'zk-123' }))
    const parsed = JSON.parse(out.configJson as string)
    expect(parsed.mcpServers['browser-agent'].env).toEqual({
      AINATIVE_API_KEY: 'zk-123',
      AINATIVE_API_URL: 'https://api.ainative.studio',
    })
  })

  it('sequential-thinking server env includes ZERODB_BASE_URL and honors ZERODB_PROJECT_ID', () => {
    const out = buildAgentMcpWiring(
      env({ ZERODB_API_KEY: 'zk-123', ZERODB_PROJECT_ID: 'proj-1' }),
    )
    const parsed = JSON.parse(out.configJson as string)
    expect(parsed.mcpServers['sequential-thinking'].env).toEqual({
      ZERODB_API_KEY: 'zk-123',
      ZERODB_BASE_URL: 'https://api.ainative.studio',
      ZERODB_PROJECT_ID: 'proj-1',
    })
  })

  it('every wired server spawns via process.execPath (no PATH lookup) with a stdio type', () => {
    const out = buildAgentMcpWiring(env({ ZERODB_API_KEY: 'zk-123' }))
    const parsed = JSON.parse(out.configJson as string)
    for (const name of ['zerodb', 'browser-agent', 'sequential-thinking']) {
      expect(parsed.mcpServers[name].type).toBe('stdio')
      expect(parsed.mcpServers[name].command).toBe(process.execPath)
      expect(Array.isArray(parsed.mcpServers[name].args)).toBe(true)
      expect(parsed.mcpServers[name].args[0]).toMatch(/node_modules.*index\.js$/)
    }
  })

  // builder#555 (re-scoped): a real Node-native ZeroPipeline MCP server now
  // ships as a local file in this repo (lib/agent/mcp-servers/zeropipeline-mcp-server.mjs)
  // — a genuine reimplementation calling ZeroPipeline's real REST API
  // directly, NOT the broken `@ainative/zeropipeline-mcp` npm shim (still
  // correctly unwired — see the REALITY CHECK comment above MCP_SERVER_SPECS).
  // These tests run against the REAL local file, existence-checked like the
  // other three servers.
  describe('ZeroPipeline wiring (builder#555 — real Node-native server)', () => {
    it('wires zeropipeline when ZEROPIPELINE_API_KEY is present and the local server file exists', () => {
      const out = buildAgentMcpWiring(env({ ZEROPIPELINE_API_KEY: 'zp-123' }))
      expect(out.allowedTools).toContain('mcp__zeropipeline')
      const parsed = JSON.parse(out.configJson as string)
      expect(parsed.mcpServers.zeropipeline).toBeDefined()
    })

    it('is independent of the ZeroDB-family key — wires with ONLY ZEROPIPELINE_API_KEY set', () => {
      const out = buildAgentMcpWiring(env({ ZEROPIPELINE_API_KEY: 'zp-123' }))
      expect(out.allowedTools).toEqual(['mcp__zeropipeline'])
    })

    it('does not wire zeropipeline when ZEROPIPELINE_API_KEY is absent, even with other keys present', () => {
      const out = buildAgentMcpWiring(env({ ZERODB_API_KEY: 'zk-123' }))
      expect(out.allowedTools).not.toContain('mcp__zeropipeline')
    })

    it('env includes the default ZEROPIPELINE_API_BASE_URL and omits optional agent headers when unset', () => {
      const out = buildAgentMcpWiring(env({ ZEROPIPELINE_API_KEY: 'zp-123' }))
      const parsed = JSON.parse(out.configJson as string)
      expect(parsed.mcpServers.zeropipeline.env).toEqual({
        ZEROPIPELINE_API_KEY: 'zp-123',
        ZEROPIPELINE_API_BASE_URL: 'https://pipeline.ainative.studio/api/v1',
      })
    })

    it('honors a ZEROPIPELINE_API_BASE_URL / ZEROPIPELINE_API_URL override and passes through agent headers', () => {
      const out = buildAgentMcpWiring(
        env({
          ZEROPIPELINE_API_KEY: 'zp-123',
          ZEROPIPELINE_API_URL: 'https://staging.pipeline.example.com/api/v1',
          ZEROPIPELINE_AGENT_NAME: 'cody',
          ZEROPIPELINE_AGENT_TYPE: 'coding-agent',
        }),
      )
      const parsed = JSON.parse(out.configJson as string)
      expect(parsed.mcpServers.zeropipeline.env).toEqual({
        ZEROPIPELINE_API_KEY: 'zp-123',
        ZEROPIPELINE_API_BASE_URL: 'https://staging.pipeline.example.com/api/v1',
        ZEROPIPELINE_AGENT_NAME: 'cody',
        ZEROPIPELINE_AGENT_TYPE: 'coding-agent',
      })
    })

    it('ZEROPIPELINE_API_BASE_URL takes precedence over ZEROPIPELINE_API_URL', () => {
      const out = buildAgentMcpWiring(
        env({
          ZEROPIPELINE_API_KEY: 'zp-123',
          ZEROPIPELINE_API_BASE_URL: 'https://base-wins.example.com',
          ZEROPIPELINE_API_URL: 'https://url-loses.example.com',
        }),
      )
      const parsed = JSON.parse(out.configJson as string)
      expect(parsed.mcpServers.zeropipeline.env.ZEROPIPELINE_API_BASE_URL).toBe('https://base-wins.example.com')
    })

    it('spawns via process.execPath with a stdio type, entry resolved from the repo root (not node_modules)', () => {
      const out = buildAgentMcpWiring(env({ ZEROPIPELINE_API_KEY: 'zp-123' }))
      const parsed = JSON.parse(out.configJson as string)
      expect(parsed.mcpServers.zeropipeline.type).toBe('stdio')
      expect(parsed.mcpServers.zeropipeline.command).toBe(process.execPath)
      expect(parsed.mcpServers.zeropipeline.args[0]).toMatch(/lib\/agent\/mcp-servers\/zeropipeline-mcp-server\.mjs$/)
      expect(parsed.mcpServers.zeropipeline.args[0]).not.toMatch(/node_modules/)
    })

    it('CODY_AGENT_MCP=0 disables zeropipeline along with every other server', () => {
      const out = buildAgentMcpWiring(env({ ZEROPIPELINE_API_KEY: 'zp-123', CODY_AGENT_MCP: '0' }))
      expect(out.allowedTools).toEqual([])
      expect(out.configJson).toBeNull()
    })

    it('wires alongside the other three servers when all four keys are present', () => {
      const out = buildAgentMcpWiring(env({ ZERODB_API_KEY: 'zk-123', ZEROPIPELINE_API_KEY: 'zp-123' }))
      expect(out.allowedTools.sort()).toEqual(
        ['mcp__browser-agent', 'mcp__sequential-thinking', 'mcp__zerodb', 'mcp__zeropipeline'].sort(),
      )
    })
  })
})
