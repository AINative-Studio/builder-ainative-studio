import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * getActiveDesignTokens(userId) / parseStoredDesignTokenRow (#1193)
 *
 * The stub this replaces:
 *
 *   // TODO: Implement user-specific design tokens storage and retrieval
 *   export async function getActiveDesignTokens(userId) {
 *     // Placeholder implementation - returns null until user design tokens
 *     // are implemented
 *     logger.info('Getting active design tokens for user (not yet implemented)')
 *     return null
 *   }
 *
 * Per-user storage was never the missing piece: `design_tokens` is a real
 * Postgres table with a `user_id` FK and an `is_active` flag, seven working
 * API routes write to it with per-user ownership checks, and
 * `getActiveDesignToken(userId)` in lib/db/queries.ts already runs exactly
 * the right query (the plural/singular name difference is why no grep ever
 * connected the two). The service function simply never called it — so a
 * founder could upload AND activate a token set through a fully working UI
 * and have none of it reach the prompt: app/api/chat/route.ts:156 feeds this
 * result straight into buildEnhancedPrompt, and lib/professional-prompt.ts
 * gates the whole design-system block on it being truthy.
 *
 * The row→tokens logic is exercised through the exported pure parser so the
 * assertions are about real retrieved values rather than a mocked lazy
 * import; the short-circuit guards in getActiveDesignTokens (which must not
 * touch the database at all) are exercised through the async entry point.
 */

const REAL_STORED_TOKENS = {
  light: {
    colors: {
      primary: '#0F766E',
      secondary: '#115E59',
      accent: '#14B8A6',
      background: '#FFFFFF',
      foreground: '#0F172A',
    },
    typography: {
      fontFamily: 'Inter, sans-serif',
      sizes: { sm: '0.875rem', base: '1rem', lg: '1.125rem' },
    },
    spacing: { baseUnit: '4px', scale: [1, 2, 4, 8] },
    borderRadius: { sm: '2px', md: '6px', lg: '12px' },
  },
  dark: {
    colors: {
      primary: '#2DD4BF',
      secondary: '#14B8A6',
      background: '#0B1120',
      foreground: '#F8FAFC',
    },
    typography: {
      fontFamily: 'Inter, sans-serif',
      sizes: { sm: '0.875rem', base: '1rem', lg: '1.125rem' },
    },
    spacing: { baseUnit: '4px', scale: [1, 2, 4, 8] },
    borderRadius: { sm: '2px', md: '6px', lg: '12px' },
  },
}

const ACTIVE_ROW = {
  id: 'tok-1',
  user_id: 'user-abc',
  name: 'Teal Brand',
  version: '1.2.0',
  is_active: true,
  tokens: REAL_STORED_TOKENS,
}

describe('parseStoredDesignTokenRow', () => {
  it("returns the founder's real activated tokens from the design_tokens row", async () => {
    const { parseStoredDesignTokenRow } = await import(
      '@/lib/services/design-tokens.service'
    )
    const result = parseStoredDesignTokenRow('user-abc', ACTIVE_ROW)

    expect(result).not.toBeNull()
    // The founder's actual primary colour survives the round trip.
    expect(result!.light.colors.primary).toBe('#0F766E')
    expect(result!.light.colors.secondary).toBe('#115E59')
    expect(result!.light.typography.fontFamily).toBe('Inter, sans-serif')
    expect(result!.light.spacing.baseUnit).toBe('4px')
    expect(result!.dark?.colors.primary).toBe('#2DD4BF')
  })

  it('feeds tokens that the prompt formatter actually renders into the system prompt', async () => {
    const { parseStoredDesignTokenRow, formatTokensForPrompt } = await import(
      '@/lib/services/design-tokens.service'
    )
    const tokens = parseStoredDesignTokenRow('user-abc', ACTIVE_ROW)
    const prompt = formatTokensForPrompt(tokens!)

    // The real downstream consumer sees the founder's own colours, which is
    // the whole point of the fix — the stub made this block vanish entirely.
    expect(prompt).toContain('#0F766E')
    expect(prompt).toContain('Inter, sans-serif')
    expect(prompt).toContain('#2DD4BF') // dark mode primary
  })

  it('returns null when the user has no activated token set', async () => {
    const { parseStoredDesignTokenRow } = await import(
      '@/lib/services/design-tokens.service'
    )
    expect(parseStoredDesignTokenRow('user-no-tokens', undefined)).toBeNull()
  })

  it('returns null rather than throwing when the row is missing its tokens payload', async () => {
    const { parseStoredDesignTokenRow } = await import(
      '@/lib/services/design-tokens.service'
    )
    expect(
      parseStoredDesignTokenRow('user-abc', { id: 'tok-broken', tokens: null })
    ).toBeNull()
  })

  it('returns null for a stored payload missing the required light token set', async () => {
    const { parseStoredDesignTokenRow } = await import(
      '@/lib/services/design-tokens.service'
    )
    // No `light` — cannot be used as a DesignTokensResponse, and every
    // consumer would throw on tokens.light.colors.
    expect(
      parseStoredDesignTokenRow('user-abc', {
        id: 'tok-partial',
        tokens: { dark: REAL_STORED_TOKENS.dark },
      })
    ).toBeNull()
  })

  it('returns null when light exists but carries no typography', async () => {
    const { parseStoredDesignTokenRow } = await import(
      '@/lib/services/design-tokens.service'
    )
    expect(
      parseStoredDesignTokenRow('user-abc', {
        id: 'tok-partial-2',
        tokens: { light: { colors: { primary: '#000' } } },
      })
    ).toBeNull()
  })

  it('accepts a light-only payload (dark mode is genuinely optional)', async () => {
    const { parseStoredDesignTokenRow } = await import(
      '@/lib/services/design-tokens.service'
    )
    const result = parseStoredDesignTokenRow('user-abc', {
      id: 'tok-light-only',
      tokens: { light: REAL_STORED_TOKENS.light },
    })
    expect(result).not.toBeNull()
    expect(result!.light.colors.primary).toBe('#0F766E')
    expect(result!.dark).toBeUndefined()
  })
})

describe('getActiveDesignTokens', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null for a blank userId without touching the database', async () => {
    const { getActiveDesignTokens } = await import(
      '@/lib/services/design-tokens.service'
    )
    // If this reached lib/db/queries it would attempt a real Postgres
    // connection; resolving promptly with null proves the short-circuit.
    expect(await getActiveDesignTokens('')).toBeNull()
  })

  it("returns null for the anonymous sentinel rather than querying for a user named 'anonymous'", async () => {
    const { getActiveDesignTokens } = await import(
      '@/lib/services/design-tokens.service'
    )
    expect(await getActiveDesignTokens('anonymous')).toBeNull()
  })

  it('is no longer the "not yet implemented" stub', async () => {
    const { readFileSync } = await import('fs')
    const path = await import('path')
    const src = readFileSync(
      path.join(process.cwd(), 'lib/services/design-tokens.service.ts'),
      'utf-8'
    )

    expect(src).not.toContain(
      'TODO: Implement user-specific design tokens storage and retrieval'
    )
    expect(src).not.toContain(
      "logger.info('Getting active design tokens for user (not yet implemented)'"
    )
    expect(src).not.toContain('Placeholder implementation')
    // It really reads the per-user active row.
    expect(src).toContain('getActiveDesignToken(userId)')
  })
})
