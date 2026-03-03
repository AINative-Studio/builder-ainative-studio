/**
 * Design Token Validation & Fallback (US-026)
 *
 * Validates design token format and provides fallback to default tokens
 * when validation fails.
 *
 * Validation Rules:
 * - Colors: Must be hex (#RRGGBB or #RRGGBBAA)
 * - Font sizes: Must have unit (px, rem, em)
 * - Spacing: Must be positive number with unit
 */

import { logger } from '../logger'
import type { DesignTokens, DesignTokensResponse } from '../mcp/design-system-client'

export interface ValidationError {
  field: string
  message: string
  value?: any
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

/**
 * Default fallback tokens
 */
export const DEFAULT_DESIGN_TOKENS: DesignTokensResponse = {
  light: {
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
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
      },
    },
    spacing: {
      baseUnit: '4px',
      scale: [0, 4, 8, 12, 16, 24, 32, 48, 64, 96],
    },
    borderRadius: {
      sm: '0.125rem',
      md: '0.375rem',
      lg: '0.5rem',
    },
  },
  dark: {
    colors: {
      primary: '#60A5FA',
      secondary: '#A78BFA',
      accent: '#34D399',
      background: '#0F172A',
      foreground: '#F1F5F9',
      muted: '#94A3B8',
      destructive: '#F87171',
    },
    typography: {
      fontFamily: 'Inter, system-ui, sans-serif',
      sizes: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
      },
    },
    spacing: {
      baseUnit: '4px',
      scale: [0, 4, 8, 12, 16, 24, 32, 48, 64, 96],
    },
    borderRadius: {
      sm: '0.125rem',
      md: '0.375rem',
      lg: '0.5rem',
    },
  },
}

/**
 * Validate hex color format
 */
function isValidHexColor(color: string): boolean {
  // Match #RGB, #RRGGBB, or #RRGGBBAA
  const hexPattern = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/
  return hexPattern.test(color)
}

/**
 * Validate size format (must have unit)
 */
function isValidSize(size: string): boolean {
  // Must have a numeric value followed by a unit
  const sizePattern = /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)$/
  return sizePattern.test(size.trim())
}

/**
 * Validate positive size (for spacing)
 */
function isValidPositiveSize(size: string | number): boolean {
  if (typeof size === 'number') {
    return size >= 0
  }
  const sizePattern = /^\d+(\.\d+)?(px|rem|em)$/
  return sizePattern.test(size.trim())
}

/**
 * Validate color object
 */
function validateColors(
  colors: DesignTokens['colors'],
  mode: 'light' | 'dark'
): ValidationError[] {
  const errors: ValidationError[] = []

  if (!colors) {
    errors.push({
      field: `${mode}.colors`,
      message: 'Colors object is required',
    })
    return errors
  }

  // Validate required colors
  const requiredColors = ['primary', 'secondary']
  for (const colorName of requiredColors) {
    const color = colors[colorName as keyof typeof colors]
    if (!color) {
      errors.push({
        field: `${mode}.colors.${colorName}`,
        message: `Required color '${colorName}' is missing`,
      })
    } else if (!isValidHexColor(color)) {
      errors.push({
        field: `${mode}.colors.${colorName}`,
        message: `Invalid hex color format`,
        value: color,
      })
    }
  }

  // Validate optional colors
  const optionalColors = ['accent', 'background', 'foreground', 'muted', 'destructive']
  for (const colorName of optionalColors) {
    const color = colors[colorName as keyof typeof colors]
    if (color && !isValidHexColor(color)) {
      errors.push({
        field: `${mode}.colors.${colorName}`,
        message: `Invalid hex color format`,
        value: color,
      })
    }
  }

  return errors
}

/**
 * Validate typography object
 */
function validateTypography(
  typography: DesignTokens['typography'],
  mode: 'light' | 'dark'
): ValidationError[] {
  const errors: ValidationError[] = []

  if (!typography) {
    errors.push({
      field: `${mode}.typography`,
      message: 'Typography object is required',
    })
    return errors
  }

  // Validate font family
  if (!typography.fontFamily || typography.fontFamily.trim().length === 0) {
    errors.push({
      field: `${mode}.typography.fontFamily`,
      message: 'Font family is required',
    })
  }

  // Validate font sizes
  if (!typography.sizes || Object.keys(typography.sizes).length === 0) {
    errors.push({
      field: `${mode}.typography.sizes`,
      message: 'At least one font size is required',
    })
  } else {
    for (const [sizeName, sizeValue] of Object.entries(typography.sizes)) {
      if (sizeValue && !isValidSize(sizeValue)) {
        errors.push({
          field: `${mode}.typography.sizes.${sizeName}`,
          message: 'Font size must have a unit (px, rem, em)',
          value: sizeValue,
        })
      }
    }
  }

  return errors
}

/**
 * Validate spacing object
 */
function validateSpacing(
  spacing: DesignTokens['spacing'],
  mode: 'light' | 'dark'
): ValidationError[] {
  const errors: ValidationError[] = []

  if (!spacing) {
    errors.push({
      field: `${mode}.spacing`,
      message: 'Spacing object is required',
    })
    return errors
  }

  // Validate base unit
  if (!spacing.baseUnit) {
    errors.push({
      field: `${mode}.spacing.baseUnit`,
      message: 'Base unit is required',
    })
  } else if (!isValidPositiveSize(spacing.baseUnit)) {
    errors.push({
      field: `${mode}.spacing.baseUnit`,
      message: 'Base unit must be a positive number with unit (px, rem, em)',
      value: spacing.baseUnit,
    })
  }

  // Validate scale
  if (!spacing.scale || !Array.isArray(spacing.scale)) {
    errors.push({
      field: `${mode}.spacing.scale`,
      message: 'Spacing scale must be an array',
    })
  } else {
    spacing.scale.forEach((value, index) => {
      if (typeof value !== 'number' || value < 0) {
        errors.push({
          field: `${mode}.spacing.scale[${index}]`,
          message: 'Scale values must be positive numbers',
          value,
        })
      }
    })
  }

  return errors
}

/**
 * Validate border radius (optional)
 */
function validateBorderRadius(
  borderRadius: DesignTokens['borderRadius'],
  mode: 'light' | 'dark'
): ValidationError[] {
  const errors: ValidationError[] = []

  if (!borderRadius) {
    return errors // Border radius is optional
  }

  for (const [sizeName, sizeValue] of Object.entries(borderRadius)) {
    if (sizeValue && !isValidSize(sizeValue)) {
      errors.push({
        field: `${mode}.borderRadius.${sizeName}`,
        message: 'Border radius must have a unit (px, rem, em)',
        value: sizeValue,
      })
    }
  }

  return errors
}

/**
 * Validate a single design token set (light or dark)
 */
function validateDesignTokenSet(
  tokens: DesignTokens,
  mode: 'light' | 'dark'
): ValidationError[] {
  const errors: ValidationError[] = []

  if (!tokens) {
    errors.push({
      field: mode,
      message: `${mode} mode tokens are required`,
    })
    return errors
  }

  errors.push(...validateColors(tokens.colors, mode))
  errors.push(...validateTypography(tokens.typography, mode))
  errors.push(...validateSpacing(tokens.spacing, mode))
  errors.push(...validateBorderRadius(tokens.borderRadius, mode))

  return errors
}

/**
 * Validate complete design tokens response
 */
export function validateDesignTokens(tokens: DesignTokensResponse): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  // Validate light mode (required)
  errors.push(...validateDesignTokenSet(tokens.light, 'light'))

  // Validate dark mode (optional but recommended)
  if (!tokens.dark) {
    warnings.push('Dark mode tokens not provided - consider adding for better theme support')
  } else {
    errors.push(...validateDesignTokenSet(tokens.dark, 'dark'))
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validate and return tokens with fallback
 * If validation fails, log warning and return default tokens
 */
export function validateOrFallback(tokens: DesignTokensResponse | null): DesignTokensResponse {
  if (!tokens) {
    logger.warn('No design tokens provided, using defaults')
    return DEFAULT_DESIGN_TOKENS
  }

  const validation = validateDesignTokens(tokens)

  if (!validation.valid) {
    logger.warn('Design token validation failed, using default tokens', {
      errors: validation.errors,
      warnings: validation.warnings,
    })
    return DEFAULT_DESIGN_TOKENS
  }

  if (validation.warnings.length > 0) {
    logger.info('Design token validation warnings', { warnings: validation.warnings })
  }

  return tokens
}

/**
 * Merge tokens with defaults (fill in missing values)
 */
export function mergeWithDefaults(
  tokens: Partial<DesignTokensResponse>
): DesignTokensResponse {
  return {
    light: {
      colors: {
        ...DEFAULT_DESIGN_TOKENS.light.colors,
        ...(tokens.light?.colors || {}),
      },
      typography: {
        fontFamily: tokens.light?.typography?.fontFamily || DEFAULT_DESIGN_TOKENS.light.typography.fontFamily,
        sizes: {
          ...DEFAULT_DESIGN_TOKENS.light.typography.sizes,
          ...(tokens.light?.typography?.sizes || {}),
        },
      },
      spacing: {
        baseUnit: tokens.light?.spacing?.baseUnit || DEFAULT_DESIGN_TOKENS.light.spacing.baseUnit,
        scale: tokens.light?.spacing?.scale || DEFAULT_DESIGN_TOKENS.light.spacing.scale,
      },
      borderRadius: {
        ...DEFAULT_DESIGN_TOKENS.light.borderRadius,
        ...(tokens.light?.borderRadius || {}),
      },
    },
    dark: {
      colors: {
        ...DEFAULT_DESIGN_TOKENS.dark!.colors,
        ...(tokens.dark?.colors || {}),
      },
      typography: {
        fontFamily: tokens.dark?.typography?.fontFamily || DEFAULT_DESIGN_TOKENS.dark!.typography.fontFamily,
        sizes: {
          ...DEFAULT_DESIGN_TOKENS.dark!.typography.sizes,
          ...(tokens.dark?.typography?.sizes || {}),
        },
      },
      spacing: {
        baseUnit: tokens.dark?.spacing?.baseUnit || DEFAULT_DESIGN_TOKENS.dark!.spacing.baseUnit,
        scale: tokens.dark?.spacing?.scale || DEFAULT_DESIGN_TOKENS.dark!.spacing.scale,
      },
      borderRadius: {
        ...DEFAULT_DESIGN_TOKENS.dark!.borderRadius,
        ...(tokens.dark?.borderRadius || {}),
      },
    },
  }
}
