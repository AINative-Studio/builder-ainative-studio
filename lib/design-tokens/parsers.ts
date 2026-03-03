import { DesignTokens } from "./types";

/**
 * Parse JSON design tokens
 */
export function parseJSONTokens(jsonString: string): DesignTokens {
  try {
    const parsed = JSON.parse(jsonString);
    return parsed as DesignTokens;
  } catch (error) {
    throw new Error(`Invalid JSON format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Parse CSS variables from CSS file content
 */
export function parseCSSVariables(cssContent: string): Partial<DesignTokens> {
  const lines = cssContent.split('\n');
  const colors: Record<string, string> = {};
  const typography: Record<string, string> = {};
  const spacing: Record<string, string> = {};

  // Extract CSS custom properties
  const cssVarRegex = /--([a-zA-Z0-9-_]+):\s*([^;]+);?/g;

  for (const line of lines) {
    const matches = [...line.matchAll(cssVarRegex)];

    for (const match of matches) {
      const [, varName, value] = match;
      const cleanValue = value.trim();

      // Categorize variables
      if (varName.includes('color') || varName.includes('bg') || varName.includes('text')) {
        colors[varName] = cleanValue;
      } else if (varName.includes('font') || varName.includes('text-')) {
        typography[varName] = cleanValue;
      } else if (varName.includes('spacing') || varName.includes('gap') || varName.includes('padding') || varName.includes('margin')) {
        spacing[varName] = cleanValue;
      }
    }
  }

  // Map to standard design token structure
  const tokens: Partial<DesignTokens> = {
    name: "Imported from CSS",
    version: "1.0.0",
    colors: {
      primary: colors['color-primary'] || colors['primary'] || colors['primary-color'] || '#3B82F6',
      secondary: colors['color-secondary'] || colors['secondary'] || colors['secondary-color'] || '#8B5CF6',
      accent: colors['color-accent'] || colors['accent'] || colors['accent-color'] || '#F59E0B',
      background: colors['color-background'] || colors['bg'] || colors['background'],
      foreground: colors['color-foreground'] || colors['text'] || colors['foreground'],
    },
    typography: {
      fontFamily: typography['font-family'] || typography['font-sans'] || 'Inter, sans-serif',
      sizes: {
        xs: typography['text-xs'] || typography['font-size-xs'] || '12px',
        sm: typography['text-sm'] || typography['font-size-sm'] || '14px',
        base: typography['text-base'] || typography['font-size-base'] || '16px',
        lg: typography['text-lg'] || typography['font-size-lg'] || '18px',
        xl: typography['text-xl'] || typography['font-size-xl'] || '20px',
      },
    },
    spacing: {
      baseUnit: spacing['spacing-base'] || spacing['base-unit'] || '4px',
      scale: [0, 1, 2, 4, 6, 8, 12, 16, 24, 32],
    },
  };

  return tokens;
}

/**
 * Convert design tokens to CSS variables
 */
export function tokensToCSSVariables(tokens: DesignTokens): string {
  const cssVars: string[] = [
    ':root {',
    '  /* Colors */',
    `  --color-primary: ${tokens.colors.primary};`,
    `  --color-secondary: ${tokens.colors.secondary};`,
    `  --color-accent: ${tokens.colors.accent};`,
  ];

  if (tokens.colors.background) {
    cssVars.push(`  --color-background: ${tokens.colors.background};`);
  }
  if (tokens.colors.foreground) {
    cssVars.push(`  --color-foreground: ${tokens.colors.foreground};`);
  }
  if (tokens.colors.muted) {
    cssVars.push(`  --color-muted: ${tokens.colors.muted};`);
  }
  if (tokens.colors.mutedForeground) {
    cssVars.push(`  --color-muted-foreground: ${tokens.colors.mutedForeground};`);
  }
  if (tokens.colors.border) {
    cssVars.push(`  --color-border: ${tokens.colors.border};`);
  }

  cssVars.push('', '  /* Typography */');
  cssVars.push(`  --font-family: ${tokens.typography.fontFamily};`);

  Object.entries(tokens.typography.sizes).forEach(([key, value]) => {
    cssVars.push(`  --font-size-${key}: ${value};`);
  });

  if (tokens.typography.weights) {
    Object.entries(tokens.typography.weights).forEach(([key, value]) => {
      cssVars.push(`  --font-weight-${key}: ${value};`);
    });
  }

  cssVars.push('', '  /* Spacing */');
  cssVars.push(`  --spacing-base: ${tokens.spacing.baseUnit};`);

  tokens.spacing.scale.forEach((value, index) => {
    cssVars.push(`  --spacing-${index}: ${value};`);
  });

  if (tokens.borderRadius) {
    cssVars.push('', '  /* Border Radius */');
    Object.entries(tokens.borderRadius).forEach(([key, value]) => {
      cssVars.push(`  --border-radius-${key}: ${value};`);
    });
  }

  cssVars.push('}');

  return cssVars.join('\n');
}

/**
 * Generate default design tokens
 */
export function getDefaultTokens(): DesignTokens {
  return {
    name: "New Design System",
    version: "1.0.0",
    colors: {
      primary: "#3B82F6",
      secondary: "#8B5CF6",
      accent: "#F59E0B",
      background: "#FFFFFF",
      foreground: "#0A0A0A",
      muted: "#F4F4F5",
      mutedForeground: "#71717A",
      border: "#E4E4E7",
    },
    typography: {
      fontFamily: "Inter, system-ui, sans-serif",
      sizes: {
        xs: "12px",
        sm: "14px",
        base: "16px",
        lg: "18px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "30px",
      },
      weights: {
        normal: "400",
        medium: "500",
        semibold: "600",
        bold: "700",
      },
    },
    spacing: {
      baseUnit: "4px",
      scale: [0, 1, 2, 4, 6, 8, 12, 16, 24, 32, 40, 48, 64],
    },
    borderRadius: {
      sm: "4px",
      md: "8px",
      lg: "12px",
      xl: "16px",
    },
  };
}
