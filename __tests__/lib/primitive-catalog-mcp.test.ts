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

  it('adds mcpUrl + mcpTools to ZeroDB (69 tools) — the phase-1 wedge', () => {
    const zerodb = getPrimitive('ZeroDB')
    expect(zerodb?.mcpUrl).toBeTruthy()
    expect(zerodb?.mcpTools).toBe(69)
  })

  it('adds MCP metadata to the other published servers from §6', () => {
    expect(getPrimitive('ZeroMemory')?.mcpTools).toBe(18)
    expect(getPrimitive('ZeroVoice')?.mcpTools).toBe(25)
    expect(getPrimitive('Content Workflow')?.mcpTools).toBe(21) // Strapi MCP
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

  it('getMcpOperablePrimitives returns only primitives with an mcpUrl', () => {
    const operable = getMcpOperablePrimitives()
    expect(operable.length).toBeGreaterThanOrEqual(4)
    expect(operable.every((p) => !!p.mcpUrl)).toBe(true)
    expect(operable.map((p) => p.name)).toContain('ZeroDB')
    expect(operable.map((p) => p.name)).not.toContain('ZeroCommerce')
    // OpenCapStack is MCP-operable via stdio (MCP_SERVERS), not a catalog mcpUrl.
    expect(operable.map((p) => p.name)).not.toContain('OpenCapStack')
  })

  it('isMcpOperable reflects mcp metadata', () => {
    expect(isMcpOperable('ZeroDB')).toBe(true)
    expect(isMcpOperable('ZeroVoice')).toBe(true)
    expect(isMcpOperable('ZeroCommerce')).toBe(false)
    expect(isMcpOperable('nonexistent primitive')).toBe(false)
  })

  it('MCP_SERVERS covers the 7+ published servers with ids + transports', () => {
    const ids = MCP_SERVERS.map((s) => s.id)
    for (const id of ['zerodb', 'memory', 'prd-generator', 'sequential-thinking', 'design-system', 'strapi', 'zerovoice', 'gtm', 'opencapstack']) {
      expect(ids).toContain(id)
    }
    // ZeroDB is the full 69-tool HTTP server.
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
