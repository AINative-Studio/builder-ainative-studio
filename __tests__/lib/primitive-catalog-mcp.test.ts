import { describe, it, expect } from 'vitest'
import {
  CATALOG,
  getPrimitive,
  getMcpServer,
  getMcpOperablePrimitives,
  isMcpOperable,
  MCP_SERVERS,
  selectPrimitives,
  CATALOG_SIZE,
} from '@/lib/build/primitive-catalog'

describe('primitive-catalog MCP metadata (#73)', () => {
  it('preserves #72 selection behavior (additive only)', () => {
    // Guard: MCP fields must not change triggers/scoring (#72) or selection.
    const sel = selectPrimitives('a coffee brand storefront', 'company')
    expect(sel.names).toContain('ZeroCommerce')
    const social = selectPrimitives('a social network with followers and a feed', 'company')
    expect(social.names.some((n) => n === 'Social Graph' || n === 'Community')).toBe(true)
    expect(CATALOG_SIZE).toBe(CATALOG.length)
  })

  it('does NOT add mcpUrl/mcpTools to ZeroMemory/ZeroVoice/Content Workflow (#534)', () => {
    // mcp.ainative.studio is confirmed DEAD (live curl: real 404 on every
    // tested path, served by builder's own SPA catch-all, not an MCP
    // handler) — Refs core#6667, still open. Asserting these fields would
    // claim a capability that doesn't exist, the same bug class fixed for
    // OpenCapStack in #429/#413. No stdio-npm alternative is known to exist
    // for these three, unlike ZeroDB's real `ainative-zerodb-mcp-server`.
    expect(getPrimitive('ZeroMemory')?.mcpUrl).toBeUndefined()
    expect(getPrimitive('ZeroMemory')?.mcpTools).toBeUndefined()
    expect(getPrimitive('ZeroVoice')?.mcpUrl).toBeUndefined()
    expect(getPrimitive('ZeroVoice')?.mcpTools).toBeUndefined()
    expect(getPrimitive('Content Workflow')?.mcpUrl).toBeUndefined() // Strapi MCP
    expect(getPrimitive('Content Workflow')?.mcpTools).toBeUndefined()
    // OpenCapStack ships an MCP server (@opencapstack/mcp-server, stdio) but it
    // isn't AINative-hosted, so it has no mcpUrl on the catalog primitive itself
    // — it's registered in MCP_SERVERS instead (#413).
    expect(getPrimitive('OpenCapStack')?.mcpUrl).toBeUndefined()
    expect(getPrimitive('OpenCapStack')?.mcpTools).toBeUndefined()
  })

  it('leaves non-MCP primitives without mcp fields', () => {
    const commerce = getPrimitive('ZeroCommerce')
    expect(commerce?.mcpUrl).toBeUndefined()
    expect(commerce?.mcpTools).toBeUndefined()
    // But its REST base (#72/#218) is untouched.
    expect(commerce?.apiBase).toBe('https://zerocommerce.ainative.studio/api/v1')
  })

  it('getMcpOperablePrimitives returns only primitives with a real mcpUrl (#534: ZeroDB only)', () => {
    // ZeroDB is the only catalog primitive still carrying an mcpUrl. Its field
    // still points at the same dead MCP_BASE host as everything else (not yet
    // corrected here — out of scope for #534, which only removed the fields
    // proven to have NO real backing at all); ZeroDB's genuinely live MCP path
    // is the separate stdio wiring in lib/agent/agent-runtime.ts, which does
    // not consult this catalog field.
    const operable = getMcpOperablePrimitives()
    expect(operable.map((p) => p.name)).toEqual(['ZeroDB'])
    expect(operable.every((p) => !!p.mcpUrl)).toBe(true)
    expect(operable.map((p) => p.name)).not.toContain('ZeroCommerce')
    expect(operable.map((p) => p.name)).not.toContain('ZeroMemory')
    expect(operable.map((p) => p.name)).not.toContain('ZeroVoice')
    expect(operable.map((p) => p.name)).not.toContain('Content Workflow')
    // OpenCapStack is MCP-operable via stdio (MCP_SERVERS), not a catalog mcpUrl.
    expect(operable.map((p) => p.name)).not.toContain('OpenCapStack')
  })

  it('isMcpOperable reflects mcp metadata (#534: only ZeroDB\'s catalog field is set)', () => {
    expect(isMcpOperable('ZeroDB')).toBe(true)
    expect(isMcpOperable('ZeroVoice')).toBe(false)
    expect(isMcpOperable('ZeroMemory')).toBe(false)
    expect(isMcpOperable('Content Workflow')).toBe(false)
    expect(isMcpOperable('ZeroCommerce')).toBe(false)
    expect(isMcpOperable('nonexistent primitive')).toBe(false)
  })

  it('MCP_SERVERS still lists the documented (but unverified/dead) fleet ids + transports', () => {
    // #534: MCP_SERVERS is a separate array from the catalog's mcpUrl fields
    // and intentionally keeps every documented server id discoverable — but
    // see the REALITY CHECK comment above this array: every `transport:
    // 'http'` entry points at the confirmed-dead mcp.ainative.studio host
    // (core#6667). This test only asserts the array's shape, not reachability.
    const ids = MCP_SERVERS.map((s) => s.id)
    for (const id of ['zerodb', 'memory', 'prd-generator', 'sequential-thinking', 'design-system', 'strapi', 'zerovoice', 'gtm', 'opencapstack']) {
      expect(ids).toContain(id)
    }
    // ZeroDB is labeled as the full 69-tool HTTP server, though that HTTP path
    // is unverified/dead — its real live wiring is the separate stdio path in
    // lib/agent/agent-runtime.ts, not this entry.
    const zerodb = getMcpServer('zerodb')
    expect(zerodb?.tools).toBe(69)
    expect(zerodb?.transport).toBe('http')
    expect(zerodb?.primitive).toBe('ZeroDB')
    // GTM is stdio (npx).
    expect(getMcpServer('gtm')?.transport).toBe('stdio')
    // OpenCapStack is stdio too (npx @opencapstack/mcp-server) — #413.
    const opencapstack = getMcpServer('opencapstack')
    expect(opencapstack?.transport).toBe('stdio')
    expect(opencapstack?.tools).toBe(27)
    expect(opencapstack?.primitive).toBe('OpenCapStack')
  })

  it('getMcpServer returns undefined for unknown ids', () => {
    expect(getMcpServer('does-not-exist')).toBeUndefined()
  })
})
