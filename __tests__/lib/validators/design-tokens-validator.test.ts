import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/validators/design-tokens.validator.ts is a distinct module from
 * lib/design-tokens/validators.ts (already covered elsewhere) — this one
 * validates the DesignTokensResponse shape returned by the MCP design-system
 * client (light/dark mode token sets) and provides fallback/merge helpers.
 * It had no dedicated test file before this change. All pure logic, no I/O,
 * except for calls into lib/logger which we mock.
 */

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

import { logger } from '@/lib/logger'
import {
  DEFAULT_DESIGN_TOKENS,
  validateDesignTokens,
  validateOrFallback,
  mergeWithDefaults,
} from '@/lib/validators/design-tokens.validator'
import type { DesignTokensResponse, DesignTokens } from '@/lib/mcp/design-system-client'

function validLightTokens(): DesignTokens {
  return {
    colors: {
      primary: '#3B82F6',
      secondary: '#8B5CF6',
      accent: '#10B981',
      background: '#FFFFFF',
      foreground: '#000000',
      muted: '#6B7280',
      destructive: '#EF4444',
    },
    typography: {
      fontFamily: 'Inter, system-ui, sans-serif',
      sizes: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
      },
    },
    spacing: {
      baseUnit: '4px',
      scale: [0, 4, 8, 12],
    },
    borderRadius: {
      sm: '0.125rem',
      md: '0.375rem',
    },
  }
}

function validResponse(): DesignTokensResponse {
  return {
    light: validLightTokens(),
    dark: validLightTokens(),
  }
}

describe('#1201 lib/validators/design-tokens.validator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('DEFAULT_DESIGN_TOKENS', () => {
    it('exposes complete, internally valid light and dark token sets', () => {
      expect(DEFAULT_DESIGN_TOKENS.light.colors.primary).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(DEFAULT_DESIGN_TOKENS.dark!.colors.primary).toMatch(/^#[0-9A-Fa-f]{6}$/)
      const result = validateDesignTokens(DEFAULT_DESIGN_TOKENS)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  describe('validateDesignTokens — colors', () => {
    it('passes a fully valid tokens response with no warnings', () => {
      const result = validateDesignTokens(validResponse())
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.warnings).toEqual([])
    })

    it('errors when the colors object is missing entirely and skips sub-checks', () => {
      const tokens = validResponse()
      delete (tokens.light as Partial<DesignTokens>).colors
      const result = validateDesignTokens(tokens)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual({
        field: 'light.colors',
        message: 'Colors object is required',
      })
    })

    it.each(['primary', 'secondary'] as const)(
      'errors when required color "%s" is missing',
      (colorName) => {
        const tokens = validResponse()
        delete (tokens.light.colors as Record<string, string | undefined>)[colorName]
        const result = validateDesignTokens(tokens)

        expect(result.errors).toContainEqual({
          field: `light.colors.${colorName}`,
          message: `Required color '${colorName}' is missing`,
        })
      }
    )

    it('errors when a required color is present but not valid hex', () => {
      const tokens = validResponse()
      tokens.light.colors.primary = 'blue'
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.colors.primary',
        message: 'Invalid hex color format',
        value: 'blue',
      })
    })

    it.each(['accent', 'background', 'foreground', 'muted', 'destructive'] as const)(
      'errors when optional color "%s" is present but invalid, and is silently skipped when absent',
      (colorName) => {
        const tokens = validResponse()
        ;(tokens.light.colors as Record<string, string | undefined>)[colorName] = 'not-a-color'
        const invalidResult = validateDesignTokens(tokens)
        expect(invalidResult.errors).toContainEqual({
          field: `light.colors.${colorName}`,
          message: 'Invalid hex color format',
          value: 'not-a-color',
        })

        const tokensWithoutOptional = validResponse()
        delete (tokensWithoutOptional.light.colors as Record<string, string | undefined>)[colorName]
        const absentResult = validateDesignTokens(tokensWithoutOptional)
        expect(absentResult.errors.find((e) => e.field === `light.colors.${colorName}`)).toBeUndefined()
      }
    )

    it('accepts 3-digit and 8-digit hex colors as valid', () => {
      const tokens = validResponse()
      tokens.light.colors.primary = '#fff'
      tokens.light.colors.secondary = '#aabbccdd'
      const result = validateDesignTokens(tokens)
      expect(result.errors.find((e) => e.field.startsWith('light.colors'))).toBeUndefined()
    })
  })

  describe('validateDesignTokens — typography', () => {
    it('errors once when typography object is missing and skips sub-checks', () => {
      const tokens = validResponse()
      delete (tokens.light as Partial<DesignTokens>).typography
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.typography',
        message: 'Typography object is required',
      })
      expect(result.errors.filter((e) => e.field.startsWith('light.typography.'))).toEqual([])
    })

    it('errors when fontFamily is missing', () => {
      const tokens = validResponse()
      delete (tokens.light.typography as Partial<DesignTokens['typography']>).fontFamily
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.typography.fontFamily',
        message: 'Font family is required',
      })
    })

    it('errors when fontFamily is whitespace-only', () => {
      const tokens = validResponse()
      tokens.light.typography.fontFamily = '   '
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.typography.fontFamily',
        message: 'Font family is required',
      })
    })

    it('errors once when sizes is missing or empty, and skips per-size checks', () => {
      const tokens = validResponse()
      tokens.light.typography.sizes = {}
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.typography.sizes',
        message: 'At least one font size is required',
      })
    })

    it('errors per-size when a size value has no unit', () => {
      const tokens = validResponse()
      tokens.light.typography.sizes = { xs: '12', base: '1rem' }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.typography.sizes.xs',
        message: 'Font size must have a unit (px, rem, em)',
        value: '12',
      })
      expect(result.errors.find((e) => e.field === 'light.typography.sizes.base')).toBeUndefined()
    })
  })

  describe('validateDesignTokens — spacing', () => {
    it('errors once when spacing is missing and skips sub-checks', () => {
      const tokens = validResponse()
      delete (tokens.light as Partial<DesignTokens>).spacing
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.spacing',
        message: 'Spacing object is required',
      })
      expect(result.errors.filter((e) => e.field.startsWith('light.spacing.'))).toEqual([])
    })

    it('errors when baseUnit is missing', () => {
      const tokens = validResponse()
      delete (tokens.light.spacing as Partial<DesignTokens['spacing']>).baseUnit
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.spacing.baseUnit',
        message: 'Base unit is required',
      })
    })

    it('errors when baseUnit is present but not a valid positive size', () => {
      const tokens = validResponse()
      tokens.light.spacing.baseUnit = 'huge'
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.spacing.baseUnit',
        message: 'Base unit must be a positive number with unit (px, rem, em)',
        value: 'huge',
      })
    })

    it('errors when scale is missing or not an array', () => {
      const missingScale = validResponse()
      delete (missingScale.light.spacing as Partial<DesignTokens['spacing']>).scale
      const missingResult = validateDesignTokens(missingScale)
      expect(missingResult.errors).toContainEqual({
        field: 'light.spacing.scale',
        message: 'Spacing scale must be an array',
      })

      const notArray = validResponse()
      ;(notArray.light.spacing as unknown as { scale: unknown }).scale = 'nope'
      const notArrayResult = validateDesignTokens(notArray)
      expect(notArrayResult.errors).toContainEqual({
        field: 'light.spacing.scale',
        message: 'Spacing scale must be an array',
      })
    })

    it('accepts a numeric baseUnit that is non-negative, and rejects a negative number', () => {
      const tokens = validResponse()
      ;(tokens.light.spacing as unknown as { baseUnit: unknown }).baseUnit = 8
      const positiveResult = validateDesignTokens(tokens)
      expect(positiveResult.errors.find((e) => e.field === 'light.spacing.baseUnit')).toBeUndefined()

      const negativeTokens = validResponse()
      ;(negativeTokens.light.spacing as unknown as { baseUnit: unknown }).baseUnit = -1
      const negativeResult = validateDesignTokens(negativeTokens)
      expect(negativeResult.errors).toContainEqual({
        field: 'light.spacing.baseUnit',
        message: 'Base unit must be a positive number with unit (px, rem, em)',
        value: -1,
      })
    })

    it('errors per-index for each negative or non-number scale value', () => {
      const tokens = validResponse()
      tokens.light.spacing.scale = [0, -4, 8, 'x' as unknown as number]
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.spacing.scale[1]',
        message: 'Scale values must be positive numbers',
        value: -4,
      })
      expect(result.errors).toContainEqual({
        field: 'light.spacing.scale[3]',
        message: 'Scale values must be positive numbers',
        value: 'x',
      })
    })
  })

  describe('validateDesignTokens — borderRadius', () => {
    it('is optional and produces no error when absent', () => {
      const tokens = validResponse()
      delete (tokens.light as Partial<DesignTokens>).borderRadius
      const result = validateDesignTokens(tokens)
      expect(result.errors.find((e) => e.field.startsWith('light.borderRadius'))).toBeUndefined()
    })

    it('errors per-key when a borderRadius value has no unit', () => {
      const tokens = validResponse()
      tokens.light.borderRadius = { sm: '4', md: '0.5rem' }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light.borderRadius.sm',
        message: 'Border radius must have a unit (px, rem, em)',
        value: '4',
      })
      expect(result.errors.find((e) => e.field === 'light.borderRadius.md')).toBeUndefined()
    })
  })

  describe('validateDesignTokens — dark mode and overall shape', () => {
    it('warns (does not error) when dark tokens are entirely absent', () => {
      const tokens = validResponse()
      delete (tokens as Partial<DesignTokensResponse>).dark
      const result = validateDesignTokens(tokens)

      expect(result.valid).toBe(true)
      expect(result.warnings).toContainEqual(
        'Dark mode tokens not provided - consider adding for better theme support'
      )
    })

    it('validates dark tokens with the same rules as light when present', () => {
      const tokens = validResponse()
      tokens.dark!.colors.primary = 'not-hex'
      const result = validateDesignTokens(tokens)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual({
        field: 'dark.colors.primary',
        message: 'Invalid hex color format',
        value: 'not-hex',
      })
    })

    it('errors with a mode-required message when the whole light token set is falsy, not just a sub-field', () => {
      const tokens = validResponse()
      ;(tokens as unknown as { light: unknown }).light = null
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'light',
        message: 'light mode tokens are required',
      })
    })

    it('combines independent light and dark failures into one result', () => {
      const tokens = validResponse()
      delete (tokens.light as Partial<DesignTokens>).colors
      tokens.dark!.typography.fontFamily = ''
      const result = validateDesignTokens(tokens)

      expect(result.valid).toBe(false)
      const fields = result.errors.map((e) => e.field)
      expect(fields).toContain('light.colors')
      expect(fields).toContain('dark.typography.fontFamily')
    })
  })

  describe('validateOrFallback', () => {
    it('returns defaults and logs a warning when tokens are null', () => {
      const result = validateOrFallback(null)
      expect(result).toEqual(DEFAULT_DESIGN_TOKENS)
      expect(logger.warn).toHaveBeenCalledWith('No design tokens provided, using defaults')
    })

    it('returns defaults and logs validation errors/warnings when validation fails', () => {
      const tokens = validResponse()
      tokens.light.colors.primary = 'invalid'
      const result = validateOrFallback(tokens)

      expect(result).toEqual(DEFAULT_DESIGN_TOKENS)
      expect(logger.warn).toHaveBeenCalledWith(
        'Design token validation failed, using default tokens',
        expect.objectContaining({ errors: expect.any(Array), warnings: expect.any(Array) })
      )
    })

    it('returns the original tokens unchanged when valid and logs no warnings info when there are none', () => {
      const tokens = validResponse()
      const result = validateOrFallback(tokens)

      expect(result).toBe(tokens)
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('returns valid tokens but logs an info-level message when there are warnings (e.g. missing dark mode)', () => {
      const tokens = validResponse()
      delete (tokens as Partial<DesignTokensResponse>).dark
      const result = validateOrFallback(tokens)

      expect(result).toBe(tokens)
      expect(logger.info).toHaveBeenCalledWith(
        'Design token validation warnings',
        expect.objectContaining({ warnings: expect.any(Array) })
      )
    })
  })

  describe('mergeWithDefaults', () => {
    it('returns an equivalent full response when given an empty object', () => {
      const result = mergeWithDefaults({})
      expect(result).toEqual(DEFAULT_DESIGN_TOKENS)
    })

    it('fills in only the missing light color keys, keeping provided ones', () => {
      const result = mergeWithDefaults({
        light: { colors: { primary: '#000000' } },
      } as Partial<DesignTokensResponse>)

      expect(result.light.colors.primary).toBe('#000000')
      expect(result.light.colors.secondary).toBe(DEFAULT_DESIGN_TOKENS.light.colors.secondary)
    })

    it('prefers a provided light fontFamily and sizes, merging missing sizes from defaults', () => {
      const result = mergeWithDefaults({
        light: {
          typography: { fontFamily: 'Custom Font', sizes: { xs: '10px' } },
        },
      } as Partial<DesignTokensResponse>)

      expect(result.light.typography.fontFamily).toBe('Custom Font')
      expect(result.light.typography.sizes.xs).toBe('10px')
      expect(result.light.typography.sizes.base).toBe(DEFAULT_DESIGN_TOKENS.light.typography.sizes.base)
    })

    it('prefers provided light spacing baseUnit/scale over defaults', () => {
      const result = mergeWithDefaults({
        light: { spacing: { baseUnit: '8px', scale: [0, 8, 16] } },
      } as Partial<DesignTokensResponse>)

      expect(result.light.spacing.baseUnit).toBe('8px')
      expect(result.light.spacing.scale).toEqual([0, 8, 16])
    })

    it('merges light borderRadius keys with defaults filling the gaps', () => {
      const result = mergeWithDefaults({
        light: { borderRadius: { sm: '1px' } },
      } as Partial<DesignTokensResponse>)

      expect(result.light.borderRadius!.sm).toBe('1px')
      expect(result.light.borderRadius!.md).toBe(DEFAULT_DESIGN_TOKENS.light.borderRadius!.md)
    })

    it('applies the same merge behavior to the dark mode set', () => {
      const result = mergeWithDefaults({
        dark: {
          colors: { primary: '#111111' },
          typography: { fontFamily: 'Dark Font', sizes: { xs: '9px' } },
          spacing: { baseUnit: '2px', scale: [0, 2] },
          borderRadius: { sm: '3px' },
        },
      } as Partial<DesignTokensResponse>)

      expect(result.dark!.colors.primary).toBe('#111111')
      expect(result.dark!.colors.secondary).toBe(DEFAULT_DESIGN_TOKENS.dark!.colors.secondary)
      expect(result.dark!.typography.fontFamily).toBe('Dark Font')
      expect(result.dark!.typography.sizes.base).toBe(DEFAULT_DESIGN_TOKENS.dark!.typography.sizes.base)
      expect(result.dark!.spacing.baseUnit).toBe('2px')
      expect(result.dark!.borderRadius!.sm).toBe('3px')
      expect(result.dark!.borderRadius!.md).toBe(DEFAULT_DESIGN_TOKENS.dark!.borderRadius!.md)
    })

    it('falls back fully to defaults for dark when dark is entirely absent from the partial input', () => {
      const result = mergeWithDefaults({ light: validLightTokens() })
      expect(result.dark).toEqual(DEFAULT_DESIGN_TOKENS.dark)
    })
  })
})
