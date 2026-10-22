import { describe, it, expect } from 'vitest'
import {
  isValidHexColor,
  isValidCSSUnit,
  isPositiveNumber,
  isValidFontFamily,
  validateDesignTokens,
} from '@/lib/design-tokens/validators'
import type { DesignTokens } from '@/lib/design-tokens/types'

/**
 * Issue #1201 — Coverage Phase 1: lib/ pure logic to 80%.
 *
 * Pure functions, no mocking required.
 */

function validTokens(): DesignTokens {
  return {
    name: 'My System',
    version: '1.0.0',
    colors: {
      primary: '#3B82F6',
      secondary: '#8B5CF6',
      accent: '#F59E0B',
    },
    typography: {
      fontFamily: 'Inter, sans-serif',
      sizes: {
        xs: '12px',
        sm: '14px',
        base: '16px',
        lg: '18px',
        xl: '20px',
      },
    },
    spacing: {
      baseUnit: '4px',
      scale: [0, 4, 8, 16],
    },
  }
}

describe('#1201 design-tokens validators', () => {
  describe('isValidHexColor', () => {
    it('accepts valid 3- and 6-digit hex colors', () => {
      expect(isValidHexColor('#fff')).toBe(true)
      expect(isValidHexColor('#FFFFFF')).toBe(true)
      expect(isValidHexColor('#3B82F6')).toBe(true)
      expect(isValidHexColor('#abc123')).toBe(true)
    })

    it('rejects invalid hex colors', () => {
      expect(isValidHexColor('fff')).toBe(false)
      expect(isValidHexColor('#ffff')).toBe(false)
      expect(isValidHexColor('#gggggg')).toBe(false)
      expect(isValidHexColor('')).toBe(false)
    })
  })

  describe('isValidCSSUnit', () => {
    it('accepts recognized units, with or without surrounding whitespace', () => {
      expect(isValidCSSUnit('4px')).toBe(true)
      expect(isValidCSSUnit('1.5rem')).toBe(true)
      expect(isValidCSSUnit('-2em')).toBe(true)
      expect(isValidCSSUnit('100%')).toBe(true)
      expect(isValidCSSUnit('10vh')).toBe(true)
      expect(isValidCSSUnit('5vw')).toBe(true)
      expect(isValidCSSUnit('  4px  ')).toBe(true)
    })

    it('rejects values with no unit, unknown units, or empty strings', () => {
      expect(isValidCSSUnit('4')).toBe(false)
      expect(isValidCSSUnit('4pixels')).toBe(false)
      expect(isValidCSSUnit('')).toBe(false)
    })
  })

  describe('isPositiveNumber', () => {
    it('accepts zero and positive numbers', () => {
      expect(isPositiveNumber(0)).toBe(true)
      expect(isPositiveNumber(1)).toBe(true)
      expect(isPositiveNumber(100.5)).toBe(true)
    })

    it('rejects negative numbers, NaN, and non-number types', () => {
      expect(isPositiveNumber(-1)).toBe(false)
      expect(isPositiveNumber(NaN)).toBe(false)
      expect(isPositiveNumber('5' as unknown as number)).toBe(false)
    })
  })

  describe('isValidFontFamily', () => {
    it('accepts a non-empty font family string', () => {
      expect(isValidFontFamily('Inter, sans-serif')).toBe(true)
    })

    it('rejects empty and whitespace-only strings', () => {
      expect(isValidFontFamily('')).toBe(false)
      expect(isValidFontFamily('   ')).toBe(false)
    })
  })

  describe('validateDesignTokens', () => {
    it('returns valid:true, empty errors, and undefined warnings for a fully valid tokens object', () => {
      const result = validateDesignTokens(validTokens())

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.warnings).toBeUndefined()
    })

    it('errors when name is missing', () => {
      const tokens = validTokens()
      delete (tokens as Partial<DesignTokens>).name
      const result = validateDesignTokens(tokens)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual({ field: 'name', message: 'Name is required' })
    })

    it('errors when name is whitespace-only', () => {
      const tokens = { ...validTokens(), name: '   ' }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({ field: 'name', message: 'Name is required' })
    })

    it('errors when name exceeds 100 characters', () => {
      const tokens = { ...validTokens(), name: 'a'.repeat(101) }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'name',
        message: 'Name must be less than 100 characters',
      })
    })

    it('errors when version is missing', () => {
      const tokens = validTokens()
      delete (tokens as Partial<DesignTokens>).version
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({ field: 'version', message: 'Version is required' })
    })

    it('warns (not errors) when version does not follow semver, and valid can still be true', () => {
      const tokens = { ...validTokens(), version: '1.0' }
      const result = validateDesignTokens(tokens)

      expect(result.errors.find((e) => e.field === 'version')).toBeUndefined()
      expect(result.warnings).toContainEqual({
        field: 'version',
        message: 'Version should follow semantic versioning (e.g., 1.0.0)',
      })
      expect(result.valid).toBe(true)
    })

    it('warns on a non-semver version like "v1.0.0" too', () => {
      const tokens = { ...validTokens(), version: 'v1.0.0' }
      const result = validateDesignTokens(tokens)

      expect(result.warnings).toContainEqual({
        field: 'version',
        message: 'Version should follow semantic versioning (e.g., 1.0.0)',
      })
    })

    it('errors once for missing colors and skips all colors.* sub-errors', () => {
      const tokens = validTokens()
      delete (tokens as Partial<DesignTokens>).colors
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({ field: 'colors', message: 'Colors are required' })
      expect(result.errors.filter((e) => e.field.startsWith('colors.'))).toEqual([])
    })

    it.each(['primary', 'secondary', 'accent'] as const)(
      'errors when required color "%s" is missing',
      (colorName) => {
        const tokens = validTokens()
        delete (tokens.colors as Record<string, string | undefined>)[colorName]
        const result = validateDesignTokens(tokens)

        const capitalized = colorName.charAt(0).toUpperCase() + colorName.slice(1)
        expect(result.errors).toContainEqual({
          field: `colors.${colorName}`,
          message: `${capitalized} color is required`,
        })
      }
    )

    it('errors when a required color is present but not a valid hex', () => {
      const tokens = { ...validTokens() }
      tokens.colors = { ...tokens.colors, primary: 'blue' }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'colors.primary',
        message: 'Primary must be a valid hex color (e.g., #3B82F6)',
      })
    })

    it('errors when an optional color is present but invalid, with a message lacking the "(e.g., ...)" suffix', () => {
      const tokens = { ...validTokens() }
      tokens.colors = { ...tokens.colors, background: 'not-a-color' }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'colors.background',
        message: 'Background must be a valid hex color',
      })
    })

    it('does not error when optional colors are simply absent', () => {
      const result = validateDesignTokens(validTokens())

      expect(result.errors.find((e) => e.field === 'colors.background')).toBeUndefined()
      expect(result.errors.find((e) => e.field === 'colors.foreground')).toBeUndefined()
      expect(result.errors.find((e) => e.field === 'colors.muted')).toBeUndefined()
      expect(result.errors.find((e) => e.field === 'colors.mutedForeground')).toBeUndefined()
      expect(result.errors.find((e) => e.field === 'colors.border')).toBeUndefined()
    })

    it('errors once for missing typography and skips all typography.* sub-errors', () => {
      const tokens = validTokens()
      delete (tokens as Partial<DesignTokens>).typography
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'typography',
        message: 'Typography is required',
      })
      expect(result.errors.filter((e) => e.field.startsWith('typography.'))).toEqual([])
    })

    it('errors when fontFamily is missing or invalid', () => {
      const tokens = validTokens()
      tokens.typography = { ...tokens.typography, fontFamily: '' }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'typography.fontFamily',
        message: 'Valid font family is required',
      })
    })

    it('errors once for missing typography.sizes and skips the per-size loop', () => {
      const tokens = validTokens()
      delete (tokens.typography as Partial<DesignTokens['typography']>).sizes
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'typography.sizes',
        message: 'Font sizes are required',
      })
      expect(result.errors.filter((e) => e.field.startsWith('typography.sizes.'))).toEqual([])
    })

    it.each(['xs', 'lg'] as const)('errors when size "%s" is missing', (sizeKey) => {
      const tokens = validTokens()
      const sizes = { ...tokens.typography.sizes } as Record<string, string | undefined>
      delete sizes[sizeKey]
      tokens.typography = { ...tokens.typography, sizes: sizes as DesignTokens['typography']['sizes'] }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: `typography.sizes.${sizeKey}`,
        message: `${sizeKey.toUpperCase()} size is required`,
      })
    })

    it('errors when a size is present but has no valid CSS unit', () => {
      const tokens = validTokens()
      tokens.typography = {
        ...tokens.typography,
        sizes: { ...tokens.typography.sizes, xs: '12' },
      }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'typography.sizes.xs',
        message: 'XS must include a valid CSS unit (px, rem, em)',
      })
    })

    it('errors once for missing spacing and skips all spacing.* sub-errors', () => {
      const tokens = validTokens()
      delete (tokens as Partial<DesignTokens>).spacing
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({ field: 'spacing', message: 'Spacing is required' })
      expect(result.errors.filter((e) => e.field.startsWith('spacing.'))).toEqual([])
    })

    it('errors when spacing.baseUnit is missing or invalid', () => {
      const tokens = validTokens()
      tokens.spacing = { ...tokens.spacing, baseUnit: 'nope' }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'spacing.baseUnit',
        message: 'Base unit must be a valid CSS unit (e.g., 4px)',
      })
    })

    it('errors when spacing.scale is missing entirely', () => {
      const tokens = validTokens()
      delete (tokens.spacing as Partial<DesignTokens['spacing']>).scale
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'spacing.scale',
        message: 'Spacing scale must be an array',
      })
    })

    it('errors the same way when spacing.scale is present but not an array', () => {
      const tokens = validTokens()
      tokens.spacing = { ...tokens.spacing, scale: 'not-an-array' as unknown as number[] }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'spacing.scale',
        message: 'Spacing scale must be an array',
      })
    })

    it('errors with a distinct message when spacing.scale is an empty array', () => {
      const tokens = validTokens()
      tokens.spacing = { ...tokens.spacing, scale: [] }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'spacing.scale',
        message: 'Spacing scale cannot be empty',
      })
    })

    it('errors per-index for each negative value in spacing.scale, not just the first', () => {
      const tokens = validTokens()
      tokens.spacing = { ...tokens.spacing, scale: [0, -4, 8, -16] }
      const result = validateDesignTokens(tokens)

      expect(result.errors).toContainEqual({
        field: 'spacing.scale[1]',
        message: 'Scale value at index 1 must be a positive number',
      })
      expect(result.errors).toContainEqual({
        field: 'spacing.scale[3]',
        message: 'Scale value at index 3 must be a positive number',
      })
      expect(result.errors.filter((e) => e.field.startsWith('spacing.scale['))).toHaveLength(2)
    })

    it('combines multiple independent failures into one result with all expected error fields present', () => {
      const tokens: Partial<DesignTokens> = {
        name: '',
        version: '1.0.0',
        colors: { primary: '#3B82F6', secondary: '', accent: 'not-hex' } as DesignTokens['colors'],
        // typography missing entirely
        spacing: { baseUnit: '4px', scale: [] },
      }
      const result = validateDesignTokens(tokens)

      expect(result.valid).toBe(false)
      const fields = result.errors.map((e) => e.field)
      expect(fields).toContain('name')
      expect(fields).toContain('colors.secondary')
      expect(fields).toContain('colors.accent')
      expect(fields).toContain('typography')
      expect(fields).toContain('spacing.scale')
      expect(result.errors.length).toBeGreaterThanOrEqual(5)
    })
  })
})
