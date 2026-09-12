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

  it('does NOT add mcpUrl/mcpTools to ZeroMemory/ZeroVoice/Content Workflow (#612)', () => {
    // #612 (2026-09-11): mcp.ainative.studio is confirmed LIVE (real
    // structured backend JSON from railway-hikari on every path tested, not
    // an HTML 404 — Refs core#6667). These three still don't get a distinct
    // mcpUrl here: ZeroMemory's real registered gateway name
    // (`zerodb-memory-mcp`) is the SAME path as full ZeroDB's mcpUrl above,
    // and its real tool count/split is unconfirmed (this gateway's auth
    // middleware 401s identically for real and fake server names, so an
    // unauthenticated curl can't resolve the split — see the REALITY CHECK
    // comment above MCP_SERVERS in primitive-catalog.ts); ZeroVoice and
    // Content Workflow (Strapi) are registered under MCP_SERVERS with their
    // real bare names but likewise have unconfirmed tool counts. No fields
    // are asserted here without a live authenticated confirmation.
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

  it('getMcpOperablePrimitives returns only primitives with a real mcpUrl (#612: ZeroDB only)', () => {
    // ZeroDB is the only catalog primitive still carrying an mcpUrl. Its field
    // now points at the real, live, authoritative registered gateway name
    // `zerodb-memory-mcp` (corrected #612 — was bare `zerodb`, which was never
    // a real registered path). ZeroDB's genuinely-exercised-in-production MCP
    // path is still the separate stdio wiring in lib/agent/agent-runtime.ts,
    // which does not consult this catalog field at all (Tier 2 follow-up).
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

  it('MCP_SERVERS lists the authoritative fleet ids + transports (#612: gateway confirmed LIVE)', () => {
    // #612 (2026-09-11): mcp.ainative.studio is confirmed LIVE (real
    // structured backend JSON from railway-hikari, not an HTML 404 — Refs
    // core#6667). MCP_SERVERS keeps every documented/authoritative server id
    // discoverable, including the `meta-ads-mcp` and `zerodb-memory-mcp`
    // entries added in this pass. See the REALITY CHECK comment above this
    // array for the live-curl matrix and the caveat that the gateway's auth
    // middleware makes an unauthenticated request 401 identically for a real
    // vs. fake server name — this test asserts the array's shape (ids/
    // transports/urls), not that every specific tool count has been
    // authenticated-confirmed.
    const ids = MCP_SERVERS.map((s) => s.id)
    for (const id of ['zerodb', 'memory', 'zerodb-memory-mcp', 'meta-ads-mcp', 'prd-generator', 'sequential-thinking', 'design-system', 'strapi', 'zerovoice', 'gtm', 'opencapstack']) {
      expect(ids).toContain(id)
    }
    // ZeroDB's url now points at the real authoritative registered name
    // `zerodb-memory-mcp` (corrected #612 — was bare `zerodb`, never a real
    // registered path); its genuinely-exercised-in-production MCP wiring is
    // still the separate stdio path in lib/agent/agent-runtime.ts, not this
    // entry (Tier 2 follow-up to bridge them).
    const zerodb = getMcpServer('zerodb')
    expect(zerodb?.tools).toBe(69)
    expect(zerodb?.transport).toBe('http')
    expect(zerodb?.primitive).toBe('ZeroDB')
    expect(zerodb?.url).toContain('/zerodb-memory-mcp')
    // `memory` also resolves to the same authoritative combined server.
    expect(getMcpServer('memory')?.url).toContain('/zerodb-memory-mcp')
    // The authoritative name is also directly selectable under its own id.
    expect(getMcpServer('zerodb-memory-mcp')?.url).toContain('/zerodb-memory-mcp')
    // meta-ads-mcp was missing from this array entirely — now present.
    const metaAds = getMcpServer('meta-ads-mcp')
    expect(metaAds?.transport).toBe('http')
    expect(metaAds?.tools).toBe(3)
    // strapi/zerovoice/prd-generator/sequential-thinking/design-system already
    // matched their authoritative bare names — no rename needed.
    expect(getMcpServer('strapi')?.url).toContain('/strapi')
    expect(getMcpServer('zerovoice')?.url).toContain('/zerovoice')
    // GTM is stdio (npx).
    expect(getMcpServer('gtm')?.transport).toBe('stdio')
    // OpenCapStack is stdio too (npx @opencapstack/mcp-server) — #413. It is
    // NOT one of the 8 authoritative mcp.ainative.studio servers.
    const opencapstack = getMcpServer('opencapstack')
    expect(opencapstack?.transport).toBe('stdio')
    expect(opencapstack?.tools).toBe(27)
    expect(opencapstack?.primitive).toBe('OpenCapStack')
  })

  it('getMcpServer returns undefined for unknown ids', () => {
    expect(getMcpServer('does-not-exist')).toBeUndefined()
  })
})
