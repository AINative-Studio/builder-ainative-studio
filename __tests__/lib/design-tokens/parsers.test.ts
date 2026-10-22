import { describe, it, expect } from 'vitest'
import {
  parseJSONTokens,
  parseCSSVariables,
  tokensToCSSVariables,
  getDefaultTokens,
} from '@/lib/design-tokens/parsers'
import type { DesignTokens } from '@/lib/design-tokens/types'

/**
 * Issue #1201 — Coverage Phase 1: lib/ pure logic to 80%.
 *
 * Pure functions, no mocking required.
 */

describe('#1201 design-tokens parsers', () => {
  describe('parseJSONTokens', () => {
    it('parses a valid JSON string into an object with no shape validation', () => {
      const result = parseJSONTokens('{"name":"Foo","version":"1.0.0"}')

      expect(result).toEqual({ name: 'Foo', version: '1.0.0' })
    })

    it('throws an Error prefixed "Invalid JSON format: " for malformed JSON', () => {
      expect(() => parseJSONTokens('{not valid')).toThrow(/^Invalid JSON format: /)
      expect(() => parseJSONTokens('{not valid')).toThrow(/Invalid JSON format/)
    })
  })

  describe('parseCSSVariables', () => {
    it('maps --color-primary directly into colors.primary', () => {
      const result = parseCSSVariables('--color-primary: #ABCDEF;')

      expect(result.colors?.primary).toBe('#ABCDEF')
    })

    it('falls through to every hardcoded default when no relevant variables are present', () => {
      const result = parseCSSVariables('')

      expect(result.name).toBe('Imported from CSS')
      expect(result.version).toBe('1.0.0')
      expect(result.colors?.primary).toBe('#3B82F6')
      expect(result.colors?.secondary).toBe('#8B5CF6')
      expect(result.colors?.accent).toBe('#F59E0B')
      expect(result.typography?.fontFamily).toBe('Inter, sans-serif')
      expect(result.typography?.sizes?.xs).toBe('12px')
      expect(result.typography?.sizes?.sm).toBe('14px')
      expect(result.typography?.sizes?.base).toBe('16px')
      expect(result.typography?.sizes?.lg).toBe('18px')
      expect(result.typography?.sizes?.xl).toBe('20px')
      expect(result.spacing?.baseUnit).toBe('4px')
      expect(result.spacing?.scale).toEqual([0, 1, 2, 4, 6, 8, 12, 16, 24, 32])
    })

    it('background and foreground stay undefined when no matching variable is present (no hardcoded default)', () => {
      const result = parseCSSVariables('')

      expect(result.colors?.background).toBeUndefined()
      expect(result.colors?.foreground).toBeUndefined()
    })

    it('maps --font-family into typography.fontFamily', () => {
      const result = parseCSSVariables('--font-family: Georgia;')

      expect(result.typography?.fontFamily).toBe('Georgia')
    })

    it('categorizes --text-xs into the colors bucket (contains "text", checked before the typography branch), so it does NOT reach typography.sizes.xs', () => {
      // varName.includes('text') is checked first (colors branch) via an
      // else-if chain, so "text-xs" never reaches the typography check even
      // though it also matches /text-/. Falls through to the xs default.
      const result = parseCSSVariables('--text-xs: 10px;')

      expect(result.typography?.sizes?.xs).toBe('12px')
    })

    it('also matches the --font-size-xs fallback key for sizes.xs', () => {
      const result = parseCSSVariables('--font-size-xs: 11px;')

      expect(result.typography?.sizes?.xs).toBe('11px')
    })

    it('ignores a variable matching none of the three category checks (e.g. --border-radius)', () => {
      const result = parseCSSVariables('--border-radius: 4px;')

      // Falls through entirely to defaults, unaffected by the ignored variable.
      expect(result.colors?.primary).toBe('#3B82F6')
      expect(result.typography?.fontFamily).toBe('Inter, sans-serif')
      expect(result.spacing?.baseUnit).toBe('4px')
    })

    it('always sets name "Imported from CSS" and version "1.0.0" regardless of input', () => {
      const withVars = parseCSSVariables('--color-primary: #000000; --font-family: Arial;')
      const empty = parseCSSVariables('')

      expect(withVars.name).toBe('Imported from CSS')
      expect(withVars.version).toBe('1.0.0')
      expect(empty.name).toBe('Imported from CSS')
      expect(empty.version).toBe('1.0.0')
    })

    it('parses realistic multi-line :root CSS content end to end', () => {
      const css = `
        :root {
          --color-primary: #112233;
          --font-size-base: 16px;
          --spacing-base: 8px;
        }
      `
      const result = parseCSSVariables(css)

      expect(result.colors?.primary).toBe('#112233')
      expect(result.typography?.sizes?.base).toBe('16px')
      expect(result.spacing?.baseUnit).toBe('8px')
    })
  })

  describe('tokensToCSSVariables', () => {
    it('wraps output in :root { ... } and always includes the three required colors', () => {
      const tokens = getDefaultTokens()
      const css = tokensToCSSVariables(tokens)

      expect(css.startsWith(':root {')).toBe(true)
      expect(css.endsWith('}')).toBe(true)
      expect(css).toContain(`--color-primary: ${tokens.colors.primary};`)
      expect(css).toContain(`--color-secondary: ${tokens.colors.secondary};`)
      expect(css).toContain(`--color-accent: ${tokens.colors.accent};`)
    })

    it('includes optional color variables when present on the input (via getDefaultTokens)', () => {
      const tokens = getDefaultTokens()
      const css = tokensToCSSVariables(tokens)

      expect(css).toContain(`--color-background: ${tokens.colors.background};`)
      expect(css).toContain(`--color-foreground: ${tokens.colors.foreground};`)
      expect(css).toContain(`--color-muted: ${tokens.colors.muted};`)
      expect(css).toContain(`--color-muted-foreground: ${tokens.colors.mutedForeground};`)
      expect(css).toContain(`--color-border: ${tokens.colors.border};`)
    })

    it('omits optional color variable lines entirely when those fields are absent from a minimal tokens object', () => {
      const minimal: DesignTokens = {
        name: 'Minimal',
        version: '1.0.0',
        colors: { primary: '#3B82F6', secondary: '#8B5CF6', accent: '#F59E0B' },
        typography: {
          fontFamily: 'Inter, sans-serif',
          sizes: { xs: '12px', sm: '14px', base: '16px', lg: '18px', xl: '20px' },
        },
        spacing: { baseUnit: '4px', scale: [0, 4, 8] },
      }
      const css = tokensToCSSVariables(minimal)

      expect(css).not.toContain('--color-background')
      expect(css).not.toContain('--color-foreground')
      expect(css).not.toContain('--color-muted')
      expect(css).not.toContain('--color-border')
    })

    it('emits one --font-size-<key> line per entry in typography.sizes, including custom extra keys', () => {
      const tokens: DesignTokens = {
        ...getDefaultTokens(),
        typography: {
          fontFamily: 'Inter, sans-serif',
          sizes: {
            xs: '12px',
            sm: '14px',
            base: '16px',
            lg: '18px',
            xl: '20px',
            // extra custom key beyond the standard 5
            huge: '48px',
          } as unknown as DesignTokens['typography']['sizes'],
        },
      }
      const css = tokensToCSSVariables(tokens)

      expect(css).toContain('--font-size-xs: 12px;')
      expect(css).toContain('--font-size-sm: 14px;')
      expect(css).toContain('--font-size-base: 16px;')
      expect(css).toContain('--font-size-lg: 18px;')
      expect(css).toContain('--font-size-xl: 20px;')
      expect(css).toContain('--font-size-huge: 48px;')
      expect(css).toContain(`--font-family: ${tokens.typography.fontFamily};`)
    })

    it('includes --font-weight-<key> lines only when typography.weights is present', () => {
      const withWeights = getDefaultTokens()
      const cssWith = tokensToCSSVariables(withWeights)
      expect(cssWith).toContain('--font-weight-normal: 400;')
      expect(cssWith).toContain('--font-weight-medium: 500;')
      expect(cssWith).toContain('--font-weight-semibold: 600;')
      expect(cssWith).toContain('--font-weight-bold: 700;')

      const withoutWeights: DesignTokens = {
        ...getDefaultTokens(),
        typography: {
          fontFamily: 'Inter, sans-serif',
          sizes: { xs: '12px', sm: '14px', base: '16px', lg: '18px', xl: '20px' },
        },
      }
      const cssWithout = tokensToCSSVariables(withoutWeights)
      expect(cssWithout).not.toContain('--font-weight')
    })

    it('emits --spacing-base and one --spacing-<index> line per array index (not a key name)', () => {
      const tokens: DesignTokens = {
        ...getDefaultTokens(),
        spacing: { baseUnit: '4px', scale: [0, 4, 8] },
      }
      const css = tokensToCSSVariables(tokens)

      expect(css).toContain('--spacing-base: 4px;')
      expect(css).toContain('--spacing-0: 0;')
      expect(css).toContain('--spacing-1: 4;')
      expect(css).toContain('--spacing-2: 8;')
    })

    it('includes --border-radius-<key> lines only when borderRadius is present', () => {
      const withRadius = getDefaultTokens()
      const cssWith = tokensToCSSVariables(withRadius)
      expect(cssWith).toContain(`--border-radius-sm: ${withRadius.borderRadius!.sm};`)
      expect(cssWith).toContain(`--border-radius-md: ${withRadius.borderRadius!.md};`)
      expect(cssWith).toContain(`--border-radius-lg: ${withRadius.borderRadius!.lg};`)
      expect(cssWith).toContain(`--border-radius-xl: ${withRadius.borderRadius!.xl};`)

      const withoutRadius: DesignTokens = {
        ...getDefaultTokens(),
        borderRadius: undefined,
      }
      const cssWithout = tokensToCSSVariables(withoutRadius)
      expect(cssWithout).not.toContain('--border-radius')
    })
  })

  describe('getDefaultTokens', () => {
    it('returns the exact literal default tokens shape from source', () => {
      const tokens = getDefaultTokens()

      expect(tokens).toEqual({
        name: 'New Design System',
        version: '1.0.0',
        colors: {
          primary: '#3B82F6',
          secondary: '#8B5CF6',
          accent: '#F59E0B',
          background: '#FFFFFF',
          foreground: '#0A0A0A',
          muted: '#F4F4F5',
          mutedForeground: '#71717A',
          border: '#E4E4E7',
        },
        typography: {
          fontFamily: 'Inter, system-ui, sans-serif',
          sizes: {
            xs: '12px',
            sm: '14px',
            base: '16px',
            lg: '18px',
            xl: '20px',
            '2xl': '24px',
            '3xl': '30px',
          },
          weights: {
            normal: '400',
            medium: '500',
            semibold: '600',
            bold: '700',
          },
        },
        spacing: {
          baseUnit: '4px',
          scale: [0, 1, 2, 4, 6, 8, 12, 16, 24, 32, 40, 48, 64],
        },
        borderRadius: {
          sm: '4px',
          md: '8px',
          lg: '12px',
          xl: '16px',
        },
      })
    })
  })

  describe('integration: getDefaultTokens -> tokensToCSSVariables', () => {
    it('composes to produce a CSS string containing the expected variable names', () => {
      const css = tokensToCSSVariables(getDefaultTokens())

      expect(css).toContain('--color-primary:')
      expect(css).toContain('--color-background:')
      expect(css).toContain('--font-family:')
      expect(css).toContain('--font-size-2xl:')
      expect(css).toContain('--font-weight-bold:')
      expect(css).toContain('--spacing-base:')
      expect(css).toContain('--spacing-12:')
      expect(css).toContain('--border-radius-xl:')
    })
  })
})
