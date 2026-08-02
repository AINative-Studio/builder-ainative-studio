/**
 * Command Variable Validation & Substitution (browser-safe)
 *
 * Pure helpers shared by the server-side AgentCommandService and the client
 * command palette (Issue #17). This module has NO database or Node-only
 * imports, so it is safe to bundle into client components (e.g. the variable
 * prompt dialog) without dragging in Drizzle / the postgres driver.
 */

import type { CommandVariable } from '@/lib/types/agent-commands'

export interface VariableValidationResult {
  valid: boolean
  errors: Record<string, string>
}

/**
 * Substitute {{variable}} tokens in a template with provided values.
 * Whitespace inside the braces is tolerated and all occurrences are replaced.
 */
export function substituteVariables(
  template: string,
  values: Record<string, unknown>
): string {
  let result = template

  for (const [key, value] of Object.entries(values)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g')
    result = result.replace(regex, String(value))
  }

  return result
}

/**
 * Validate a set of variable values against their declared definitions.
 */
export function validateVariables(
  variables: CommandVariable[],
  values: Record<string, unknown>
): VariableValidationResult {
  const errors: Record<string, string> = {}

  for (const variable of variables) {
    const value = values[variable.name]

    // Check required
    if (
      variable.required &&
      (value === undefined || value === null || value === '')
    ) {
      errors[variable.name] = `${variable.label} is required`
      continue
    }

    // Skip validation if not provided and not required
    if (value === undefined || value === null) continue

    // Type validation
    switch (variable.type) {
      case 'number':
        if (isNaN(Number(value))) {
          errors[variable.name] = `${variable.label} must be a number`
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors[variable.name] = `${variable.label} must be true or false`
        }
        break
      case 'select':
        if (
          variable.options &&
          !variable.options.some((opt) => opt.value === value)
        ) {
          errors[variable.name] =
            `${variable.label} must be one of the available options`
        }
        break
      case 'multiselect':
        if (!Array.isArray(value)) {
          errors[variable.name] = `${variable.label} must be an array`
        } else if (variable.options) {
          const validValues = variable.options.map((opt) => opt.value)
          const invalidValues = value.filter((v) => !validValues.includes(v))
          if (invalidValues.length > 0) {
            errors[variable.name] = `${variable.label} contains invalid values`
          }
        }
        break
      case 'url':
        try {
          new URL(String(value))
        } catch {
          errors[variable.name] = `${variable.label} must be a valid URL`
        }
        break
    }

    // Custom regex validation
    if (variable.validation && typeof value === 'string') {
      const regex = new RegExp(variable.validation)
      if (!regex.test(value)) {
        errors[variable.name] =
          variable.validationMessage || `${variable.label} is invalid`
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}
