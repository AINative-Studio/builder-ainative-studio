import { describe, it, expect } from 'vitest'
import { tokensFromDesignSystem, formatTokensForPrompt } from '@/lib/services/design-tokens.service'
import { getDesignSystem } from '@/lib/design-systems/catalog'
import { buildSystemPromptWithTokens } from '@/lib/professional-prompt'

/**
 * Design-token pipeline reconnection (#751).
 *
 * Proves the REAL prompt-building path: a founder's chosen design system's
 * REAL catalog palette (lib/design-systems/catalog.ts) reaches the actual
 * constructed system prompt string via tokensFromDesignSystem +
 * formatTokensForPrompt — the already-built (but previously disconnected
 * from the live founder path) pipeline from lib/professional-prompt.ts /
 * lib/services/design-tokens.service.ts. This inspects the REAL function's
 * OUTPUT STRING, not a mock that only checks "was called".
 *
 * Outrun is used because it's distinctive (hot pink #ff2fa0 / cyan #2ee6ff /
 * near-black #140a2b) — nothing else in this file's fixtures could
 * coincidentally produce these exact values, so their presence in the output
 * string is real proof the founder's actual choice reached the prompt.
 */
describe('tokensFromDesignSystem — catalog adapter (no MCP dependency)', () => {
  it('maps a real catalog design system into a DesignTokensResponse using ITS actual hex values', () => {
    const outrun = getDesignSystem('outrun')!
    const tokens = tokensFromDesignSystem(outrun)

    expect(tokens.light.colors.primary).toBe('#ff2fa0')
    expect(tokens.light.colors.secondary).toBe('#2ee6ff')
    expect(tokens.light.colors.accent).toBe('#2ee6ff')
    expect(tokens.light.colors.background).toBe('#140a2b')
    expect(tokens.light.colors.foreground).toBe('#fbeaff')
    expect(tokens.light.typography.fontFamily).toContain('Exo 2') // Outrun's real body font
    expect(tokens.light.borderRadius?.sm).toBe('2px') // Outrun's real radius
    // No 'dark' pair fabricated — the catalog has no separate dark variant per system.
    expect(tokens.dark).toBeUndefined()
  })

  it('a DIFFERENT chosen system produces DIFFERENT real values (not a hardcoded default)', () => {
    const ledger = getDesignSystem('ledger')! // "Economics & cost accounting" — green/gold
    const tokens = tokensFromDesignSystem(ledger)

    expect(tokens.light.colors.primary).toBe('#1f6f43')
    expect(tokens.light.colors.background).toBe('#fbfaf6')
    expect(tokens.light.colors.primary).not.toBe('#ff2fa0')
  })
})

describe('formatTokensForPrompt — real prompt fragment contains the chosen system\'s real colors', () => {
  it('PROOF: the actual formatted prompt string contains Outrun\'s real hex values', () => {
    const outrun = getDesignSystem('outrun')!
    const tokens = tokensFromDesignSystem(outrun)
    const promptFragment = formatTokensForPrompt(tokens)

    // Inspecting the REAL output string, not a mock/spy — this is the exact
    // fragment that gets appended into chat-ws's enhancedSystemPrompt.
    expect(promptFragment).toContain('#ff2fa0')
    expect(promptFragment).toContain('#2ee6ff')
    expect(promptFragment).toContain('#140a2b')
    expect(promptFragment).toMatch(/DESIGN SYSTEM/)
  })

  it('buildSystemPromptWithTokens (the already-built, previously-disconnected function) embeds the real chosen palette into the full system prompt', () => {
    const outrun = getDesignSystem('outrun')!
    const tokens = tokensFromDesignSystem(outrun)
    const fullPrompt = buildSystemPromptWithTokens(tokens)

    expect(fullPrompt).toContain('#ff2fa0')
    expect(fullPrompt).toContain('#2ee6ff')
    // The base professional prompt content is still present — additive, not a replacement.
    expect(fullPrompt).toContain('AINative Application Architect')
  })
})
