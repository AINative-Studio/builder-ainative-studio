import { DesignTokens, ValidationError, ValidationResult } from "./types";

// Validate hex color format
export function isValidHexColor(color: string): boolean {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
}

// Validate CSS unit (px, rem, em, etc.)
export function isValidCSSUnit(value: string): boolean {
  return /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)$/.test(value.trim());
}

// Validate positive number
export function isPositiveNumber(value: number): boolean {
  return typeof value === 'number' && value >= 0 && !isNaN(value);
}

// Validate font family
export function isValidFontFamily(fontFamily: string): boolean {
  return fontFamily.trim().length > 0;
}

// Validate design tokens
export function validateDesignTokens(tokens: Partial<DesignTokens>): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Validate name
  if (!tokens.name || tokens.name.trim().length === 0) {
    errors.push({ field: "name", message: "Name is required" });
  } else if (tokens.name.length > 100) {
    errors.push({ field: "name", message: "Name must be less than 100 characters" });
  }

  // Validate version
  if (!tokens.version || tokens.version.trim().length === 0) {
    errors.push({ field: "version", message: "Version is required" });
  } else if (!/^\d+\.\d+\.\d+$/.test(tokens.version)) {
    warnings.push({
      field: "version",
      message: "Version should follow semantic versioning (e.g., 1.0.0)"
    });
  }

  // Validate colors
  if (!tokens.colors) {
    errors.push({ field: "colors", message: "Colors are required" });
  } else {
    const requiredColors = ["primary", "secondary", "accent"];
    for (const color of requiredColors) {
      const value = tokens.colors[color as keyof typeof tokens.colors];
      if (!value) {
        errors.push({
          field: `colors.${color}`,
          message: `${color.charAt(0).toUpperCase() + color.slice(1)} color is required`
        });
      } else if (!isValidHexColor(value)) {
        errors.push({
          field: `colors.${color}`,
          message: `${color.charAt(0).toUpperCase() + color.slice(1)} must be a valid hex color (e.g., #3B82F6)`
        });
      }
    }

    // Validate optional colors
    const optionalColors = ["background", "foreground", "muted", "mutedForeground", "border"];
    for (const color of optionalColors) {
      const value = tokens.colors[color as keyof typeof tokens.colors];
      if (value && !isValidHexColor(value)) {
        errors.push({
          field: `colors.${color}`,
          message: `${color.charAt(0).toUpperCase() + color.slice(1)} must be a valid hex color`
        });
      }
    }
  }

  // Validate typography
  if (!tokens.typography) {
    errors.push({ field: "typography", message: "Typography is required" });
  } else {
    if (!tokens.typography.fontFamily || !isValidFontFamily(tokens.typography.fontFamily)) {
      errors.push({ field: "typography.fontFamily", message: "Valid font family is required" });
    }

    if (!tokens.typography.sizes) {
      errors.push({ field: "typography.sizes", message: "Font sizes are required" });
    } else {
      const requiredSizes = ["xs", "sm", "base", "lg", "xl"];
      for (const size of requiredSizes) {
        const value = tokens.typography.sizes[size as keyof typeof tokens.typography.sizes];
        if (!value) {
          errors.push({
            field: `typography.sizes.${size}`,
            message: `${size.toUpperCase()} size is required`
          });
        } else if (!isValidCSSUnit(value)) {
          errors.push({
            field: `typography.sizes.${size}`,
            message: `${size.toUpperCase()} must include a valid CSS unit (px, rem, em)`
          });
        }
      }
    }
  }

  // Validate spacing
  if (!tokens.spacing) {
    errors.push({ field: "spacing", message: "Spacing is required" });
  } else {
    if (!tokens.spacing.baseUnit || !isValidCSSUnit(tokens.spacing.baseUnit)) {
      errors.push({
        field: "spacing.baseUnit",
        message: "Base unit must be a valid CSS unit (e.g., 4px)"
      });
    }

    if (!tokens.spacing.scale || !Array.isArray(tokens.spacing.scale)) {
      errors.push({ field: "spacing.scale", message: "Spacing scale must be an array" });
    } else if (tokens.spacing.scale.length === 0) {
      errors.push({ field: "spacing.scale", message: "Spacing scale cannot be empty" });
    } else {
      tokens.spacing.scale.forEach((value, index) => {
        if (!isPositiveNumber(value)) {
          errors.push({
            field: `spacing.scale[${index}]`,
            message: `Scale value at index ${index} must be a positive number`
          });
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
