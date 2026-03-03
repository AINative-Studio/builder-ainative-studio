/**
 * Design Token Extraction Service (US-022)
 *
 * Handles extraction of design tokens from templates using the MCP server
 * and caching results in Redis for performance.
 *
 * Features:
 * - Token extraction from template code
 * - Redis caching with 24-hour TTL
 * - Error handling and fallback to defaults
 * - Support for both light and dark mode tokens
 */

import { getMCPClient, type DesignTokensResponse } from '../mcp/design-system-client'
import { validateOrFallback, DEFAULT_DESIGN_TOKENS } from '../validators/design-tokens.validator'
import { cacheGet, cacheSet, cacheDelete } from '../redis'
import { logger } from '../logger'

const CACHE_TTL_SECONDS = 24 * 60 * 60 // 24 hours
const CACHE_KEY_PREFIX = 'design-tokens:'

export interface TokenExtractionOptions {
  extractDarkMode?: boolean
  forceRefresh?: boolean
  templateId?: string
}

export interface TokenExtractionResult {
  tokens: DesignTokensResponse
  cached: boolean
  source: 'mcp' | 'cache' | 'default'
}

/**
 * Generate cache key for template
 */
function getCacheKey(templateId: string): string {
  return `${CACHE_KEY_PREFIX}${templateId}`
}

/**
 * Extract design tokens from template code
 */
export async function extractDesignTokens(
  templateCode: string,
  options: TokenExtractionOptions = {}
): Promise<TokenExtractionResult> {
  const {
    extractDarkMode = true,
    forceRefresh = false,
    templateId,
  } = options

  // Try to get from cache first (if templateId provided and not forcing refresh)
  if (templateId && !forceRefresh) {
    const cached = await getCachedTokens(templateId)
    if (cached) {
      logger.info('Retrieved design tokens from cache', { templateId })
      return {
        tokens: cached,
        cached: true,
        source: 'cache',
      }
    }
  }

  // Extract tokens using MCP client
  try {
    const mcpClient = getMCPClient()
    const extractedTokens = await mcpClient.extractTokens(templateCode, extractDarkMode)

    // Validate extracted tokens
    const validatedTokens = validateOrFallback(extractedTokens)

    // Cache the results if templateId provided
    if (templateId) {
      await cacheTokens(templateId, validatedTokens)
      logger.info('Cached extracted design tokens', { templateId })
    }

    return {
      tokens: validatedTokens,
      cached: false,
      source: extractedTokens ? 'mcp' : 'default',
    }
  } catch (error) {
    logger.error('Failed to extract design tokens from MCP', { error, templateId })

    // Fall back to defaults
    return {
      tokens: DEFAULT_DESIGN_TOKENS,
      cached: false,
      source: 'default',
    }
  }
}

/**
 * Get cached design tokens
 */
export async function getCachedTokens(templateId: string): Promise<DesignTokensResponse | null> {
  try {
    const cacheKey = getCacheKey(templateId)
    const cached = await cacheGet<DesignTokensResponse>(cacheKey)

    if (cached) {
      logger.debug('Cache hit for design tokens', { templateId })
      return cached
    }

    logger.debug('Cache miss for design tokens', { templateId })
    return null
  } catch (error) {
    logger.error('Error getting cached design tokens', { error, templateId })
    return null
  }
}

/**
 * Cache design tokens
 */
export async function cacheTokens(
  templateId: string,
  tokens: DesignTokensResponse
): Promise<void> {
  try {
    const cacheKey = getCacheKey(templateId)
    await cacheSet(cacheKey, tokens, CACHE_TTL_SECONDS)
    logger.debug('Cached design tokens', { templateId, ttl: CACHE_TTL_SECONDS })
  } catch (error) {
    logger.error('Error caching design tokens', { error, templateId })
  }
}

/**
 * Invalidate cached tokens for a template
 */
export async function invalidateTokenCache(templateId: string): Promise<void> {
  try {
    const cacheKey = getCacheKey(templateId)
    await cacheDelete(cacheKey)
    logger.info('Invalidated design token cache', { templateId })
  } catch (error) {
    logger.error('Error invalidating design token cache', { error, templateId })
  }
}

/**
 * Batch extract tokens from multiple templates
 */
export async function batchExtractTokens(
  templates: Array<{ id: string; code: string }>
): Promise<Map<string, TokenExtractionResult>> {
  const results = new Map<string, TokenExtractionResult>()

  await Promise.all(
    templates.map(async (template) => {
      const result = await extractDesignTokens(template.code, {
        templateId: template.id,
        extractDarkMode: true,
      })
      results.set(template.id, result)
    })
  )

  logger.info('Batch extracted design tokens', {
    count: templates.length,
    cached: Array.from(results.values()).filter((r) => r.cached).length,
  })

  return results
}

/**
 * Compare two token sets to detect changes
 */
export function compareTokens(
  tokens1: DesignTokensResponse,
  tokens2: DesignTokensResponse
): boolean {
  return JSON.stringify(tokens1) === JSON.stringify(tokens2)
}

/**
 * Get token summary for logging
 */
export function getTokenSummary(tokens: DesignTokensResponse): string {
  const lightColors = Object.keys(tokens.light.colors).length
  const lightSizes = Object.keys(tokens.light.typography.sizes).length
  const darkColors = tokens.dark ? Object.keys(tokens.dark.colors).length : 0

  return `Light: ${lightColors} colors, ${lightSizes} font sizes${
    tokens.dark ? ` | Dark: ${darkColors} colors` : ''
  }`
}

/**
 * Get active design tokens for a user
 * TODO: Implement user-specific design tokens storage and retrieval
 */
export async function getActiveDesignTokens(userId: string): Promise<DesignTokensResponse | null> {
  // Placeholder implementation - returns null until user design tokens are implemented
  logger.debug('Getting active design tokens for user (not yet implemented)', { userId })
  return null
}

/**
 * Format tokens for prompt injection (US-023, US-027)
 * Used to inject tokens into the professional prompt with dark mode support
 */
export function formatTokensForPrompt(tokens: DesignTokensResponse): string {
  const lightTokens = tokens.light
  const darkTokens = tokens.dark

  let formatted = 'DESIGN SYSTEM:\n'

  // Light mode tokens
  formatted += `Light Mode:\n`
  formatted += `- Primary Color: ${lightTokens.colors.primary}\n`
  formatted += `- Secondary Color: ${lightTokens.colors.secondary}\n`
  if (lightTokens.colors.accent) {
    formatted += `- Accent Color: ${lightTokens.colors.accent}\n`
  }
  if (lightTokens.colors.background) {
    formatted += `- Background Color: ${lightTokens.colors.background}\n`
  }
  if (lightTokens.colors.foreground) {
    formatted += `- Foreground Color: ${lightTokens.colors.foreground}\n`
  }
  formatted += `- Font Family: ${lightTokens.typography.fontFamily}\n`
  formatted += `- Base Font Size: ${lightTokens.typography.sizes.base || '1rem'}\n`
  formatted += `- Base Spacing: ${lightTokens.spacing.baseUnit}\n`

  // Dark mode tokens (if available) - US-027
  if (darkTokens) {
    formatted += `\nDark Mode:\n`
    formatted += `- Primary Color: ${darkTokens.colors.primary}\n`
    formatted += `- Secondary Color: ${darkTokens.colors.secondary}\n`
    if (darkTokens.colors.accent) {
      formatted += `- Accent Color: ${darkTokens.colors.accent}\n`
    }
    if (darkTokens.colors.background) {
      formatted += `- Background Color: ${darkTokens.colors.background}\n`
    }
    if (darkTokens.colors.foreground) {
      formatted += `- Foreground Color: ${darkTokens.colors.foreground}\n`
    }

    formatted += `\nIMPORTANT - Dark Mode Implementation:\n`
    formatted += `Generate code with dark mode support using the light-dark() CSS function:\n`
    formatted += `Example: --color-primary: light-dark(${lightTokens.colors.primary}, ${darkTokens.colors.primary});\n`
    formatted += `Example: --color-background: light-dark(${lightTokens.colors.background || '#FFFFFF'}, ${darkTokens.colors.background || '#0F172A'});\n`
    formatted += `Apply this pattern to ALL color variables for seamless theme switching.\n`
  }

  return formatted
}

/**
 * Generate CSS variables from design tokens with dark mode support (US-027)
 */
export function generateCSSVariables(tokens: DesignTokensResponse): string {
  const lightTokens = tokens.light
  const darkTokens = tokens.dark

  let css = ':root {\n'
  css += `  color-scheme: light dark;\n\n`

  // Colors with light-dark() function
  if (darkTokens) {
    css += `  /* Colors with automatic dark mode */\n`
    css += `  --color-primary: light-dark(${lightTokens.colors.primary}, ${darkTokens.colors.primary});\n`
    css += `  --color-secondary: light-dark(${lightTokens.colors.secondary}, ${darkTokens.colors.secondary});\n`
    if (lightTokens.colors.accent && darkTokens.colors.accent) {
      css += `  --color-accent: light-dark(${lightTokens.colors.accent}, ${darkTokens.colors.accent});\n`
    }
    if (lightTokens.colors.background && darkTokens.colors.background) {
      css += `  --color-background: light-dark(${lightTokens.colors.background}, ${darkTokens.colors.background});\n`
    }
    if (lightTokens.colors.foreground && darkTokens.colors.foreground) {
      css += `  --color-foreground: light-dark(${lightTokens.colors.foreground}, ${darkTokens.colors.foreground});\n`
    }
    if (lightTokens.colors.muted && darkTokens.colors.muted) {
      css += `  --color-muted: light-dark(${lightTokens.colors.muted}, ${darkTokens.colors.muted});\n`
    }
  } else {
    // Light mode only
    css += `  /* Colors (light mode only) */\n`
    css += `  --color-primary: ${lightTokens.colors.primary};\n`
    css += `  --color-secondary: ${lightTokens.colors.secondary};\n`
    if (lightTokens.colors.accent) {
      css += `  --color-accent: ${lightTokens.colors.accent};\n`
    }
    if (lightTokens.colors.background) {
      css += `  --color-background: ${lightTokens.colors.background};\n`
    }
    if (lightTokens.colors.foreground) {
      css += `  --color-foreground: ${lightTokens.colors.foreground};\n`
    }
  }

  // Typography
  css += `\n  /* Typography */\n`
  css += `  --font-family: ${lightTokens.typography.fontFamily};\n`
  for (const [name, value] of Object.entries(lightTokens.typography.sizes)) {
    if (value) {
      css += `  --font-size-${name}: ${value};\n`
    }
  }

  // Spacing
  css += `\n  /* Spacing */\n`
  css += `  --spacing-base: ${lightTokens.spacing.baseUnit};\n`
  lightTokens.spacing.scale.forEach((value, index) => {
    css += `  --spacing-${index}: ${value}${lightTokens.spacing.baseUnit.replace(/\d+/, '')};\n`
  })

  // Border radius (if available)
  if (lightTokens.borderRadius) {
    css += `\n  /* Border Radius */\n`
    for (const [name, value] of Object.entries(lightTokens.borderRadius)) {
      if (value) {
        css += `  --radius-${name}: ${value};\n`
      }
    }
  }

  css += '}\n'

  return css
}
