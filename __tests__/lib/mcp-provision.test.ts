import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isMcpProvisionEnabled,
  extractProjectId,
  provisionZeroDbViaMcp,
} from '@/lib/build/mcp-provision'
import type { McpToolResult } from '@/lib/mcp/ainative-mcp-client'

/** A fake AiNativeMcpClient shaped for the provision seam. */
function fakeClient(overrides: Partial<{
  configured: boolean
  connected: boolean
  connectResult: boolean
  createResult: McpToolResult
  tableResult: McpToolResult
}> = {}) {
  const state = { connected: overrides.connected ?? false }
  return {
    isConfigured: () => overrides.configured ?? true,
    isConnected: () => state.connected,
    connect: vi.fn(async () => {
      const ok = overrides.connectResult ?? true
      state.connected = ok
      return ok
    }),
    callTool: vi.fn(async (name: string): Promise<McpToolResult> => {
      if (name === 'zerodb_create_project') {
        return overrides.createResult ?? { content: [{ type: 'text', text: '{"project_id":"proj_abc"}' }] }
      }
      return overrides.tableResult ?? {}
    }),
  } as any
}

describe('isMcpProvisionEnabled (#73 gating)', () => {
  const orig = process.env.ENABLE_MCP_PROVISION
  afterEach(() => {
    if (orig === undefined) delete process.env.ENABLE_MCP_PROVISION
    else process.env.ENABLE_MCP_PROVISION = orig
  })

  it('is off by default', () => {
    delete process.env.ENABLE_MCP_PROVISION
    expect(isMcpProvisionEnabled()).toBe(false)
  })
  it('accepts "1" and "true"', () => {
    process.env.ENABLE_MCP_PROVISION = '1'
    expect(isMcpProvisionEnabled()).toBe(true)
    process.env.ENABLE_MCP_PROVISION = 'true'
    expect(isMcpProvisionEnabled()).toBe(true)
  })
  it('rejects other values', () => {
    process.env.ENABLE_MCP_PROVISION = 'yes'
    expect(isMcpProvisionEnabled()).toBe(false)
  })
})

describe('extractProjectId (#73)', () => {
  it('reads structuredContent.project_id', () => {
    expect(extractProjectId({ structuredContent: { project_id: 'p1' } })).toBe('p1')
  })
  it('reads projectId / id fallbacks in structuredContent', () => {
    expect(extractProjectId({ structuredContent: { projectId: 'p2' } })).toBe('p2')
    expect(extractProjectId({ structuredContent: { id: 'p3' } })).toBe('p3')
  })
  it('parses a JSON text content block', () => {
    expect(extractProjectId({ content: [{ type: 'text', text: '{"project_id":"p4"}' }] })).toBe('p4')
  })
  it('returns undefined for an error result', () => {
    expect(extractProjectId({ isError: true, content: [{ type: 'text', text: 'x' }] })).toBeUndefined()
  })
  it('returns undefined for non-JSON text', () => {
    expect(extractProjectId({ content: [{ type: 'text', text: 'not json' }] })).toBeUndefined()
  })
})

describe('provisionZeroDbViaMcp (#73 wedge)', () => {
  const orig = process.env.ENABLE_MCP_PROVISION
  beforeEach(() => { process.env.ENABLE_MCP_PROVISION = '1' })
  afterEach(() => {
    if (orig === undefined) delete process.env.ENABLE_MCP_PROVISION
    else process.env.ENABLE_MCP_PROVISION = orig
  })

  it('is inert (skipped) when the flag is off', async () => {
    delete process.env.ENABLE_MCP_PROVISION
    const r = await provisionZeroDbViaMcp({ slug: 'demo' })
    expect(r).toEqual({ ok: false, skipped: true, reason: 'flag_disabled' })
  })

  it('skips gracefully when the client is not configured (no creds)', async () => {
    const r = await provisionZeroDbViaMcp({ slug: 'demo', client: fakeClient({ configured: false }) })
    expect(r.ok).toBe(false)
    expect(r.skipped).toBe(true)
    expect(r.reason).toBe('not_configured')
  })

  it('skips when connect fails', async () => {
    const r = await provisionZeroDbViaMcp({ slug: 'demo', client: fakeClient({ connectResult: false }) })
    expect(r.ok).toBe(false)
    expect(r.skipped).toBe(true)
    expect(r.reason).toBe('connect_failed')
  })

  it('creates a real project via the ZeroDB MCP', async () => {
    const r = await provisionZeroDbViaMcp({ slug: 'demo', name: 'Demo Co', client: fakeClient() })
    expect(r.ok).toBe(true)
    expect(r.projectId).toBe('proj_abc')
    expect(r.tablesCreated).toEqual([])
  })

  it('creates tables and reports which succeeded', async () => {
    const client = fakeClient()
    // First table ok (default {}), make the second fail.
    client.callTool = vi.fn(async (name: string, args: any): Promise<McpToolResult> => {
      if (name === 'zerodb_create_project') return { content: [{ type: 'text', text: '{"project_id":"proj_abc"}' }] }
      if (args.table_name === 'bad') return { isError: true, content: [{ type: 'text', text: 'fail' }] }
      return {}
    })
    const r = await provisionZeroDbViaMcp({
      slug: 'demo',
      client,
      tables: [{ name: 'users' }, { name: 'bad' }, { name: 'posts' }],
    })
    expect(r.ok).toBe(true)
    expect(r.tablesCreated).toEqual(['users', 'posts'])
  })

  it('returns ok:false when project creation errors', async () => {
    const r = await provisionZeroDbViaMcp({
      slug: 'demo',
      client: fakeClient({ createResult: { isError: true, content: [{ type: 'text', text: 'no' }] } }),
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('create_project_failed')
  })

  it('returns ok:false when no project id can be extracted', async () => {
    const r = await provisionZeroDbViaMcp({
      slug: 'demo',
      client: fakeClient({ createResult: { content: [{ type: 'text', text: '{}' }] } }),
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_project_id')
  })

  it('never throws — swallows an unexpected client error', async () => {
    const throwing = {
      isConfigured: () => true,
      isConnected: () => false,
      connect: vi.fn(async () => { throw new Error('kaboom') }),
      callTool: vi.fn(),
    } as any
    const r = await provisionZeroDbViaMcp({ slug: 'demo', client: throwing })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('exception')
  })
})
