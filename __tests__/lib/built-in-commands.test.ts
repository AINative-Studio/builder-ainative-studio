import { describe, it, expect } from 'vitest'
import { BUILT_IN_COMMANDS } from '@/lib/data/built-in-commands'

/**
 * Integrity checks for the built-in command library (Issue #17 acceptance
 * criterion: "5+ built-in commands"). These guard against regressions where a
 * command declares a template variable that is never referenced, or references
 * a {{token}} that has no declared variable — either of which would break
 * substitution at execution time.
 */
describe('BUILT_IN_COMMANDS', () => {
  it('ships at least 5 built-in commands', () => {
    expect(BUILT_IN_COMMANDS.length).toBeGreaterThanOrEqual(5)
  })

  it('every command has a non-empty template and a semver version', () => {
    for (const cmd of BUILT_IN_COMMANDS) {
      expect(typeof cmd.template).toBe('string')
      expect(cmd.template.trim().length).toBeGreaterThan(0)
      expect(cmd.version).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('every declared variable is referenced somewhere in its template', () => {
    for (const cmd of BUILT_IN_COMMANDS) {
      for (const variable of cmd.variables) {
        expect(
          cmd.template.includes(`{{${variable.name}`),
          `variable "${variable.name}" is declared but never used in template`
        ).toBe(true)
      }
    }
  })

  it('required select variables provide options', () => {
    for (const cmd of BUILT_IN_COMMANDS) {
      for (const variable of cmd.variables) {
        if (variable.type === 'select' || variable.type === 'multiselect') {
          expect(Array.isArray(variable.options)).toBe(true)
          expect(variable.options!.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('checkpoints have unique ids within a command', () => {
    for (const cmd of BUILT_IN_COMMANDS) {
      const ids = cmd.checkpoints.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('exposes required skills as string arrays', () => {
    for (const cmd of BUILT_IN_COMMANDS) {
      expect(Array.isArray(cmd.requiredSkills)).toBe(true)
      for (const skill of cmd.requiredSkills) {
        expect(typeof skill).toBe('string')
      }
    }
  })
})
