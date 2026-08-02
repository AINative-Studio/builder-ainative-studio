import { describe, it, expect, beforeEach } from 'vitest'
import { AgentCommandService, getCommandService } from '@/lib/services/agent-command.service'
import type { CommandVariable } from '@/lib/types/agent-commands'

/**
 * Unit tests for the pure (non-DB) logic of AgentCommandService:
 * template variable substitution and variable validation. These are the
 * building blocks the command palette (Issue #17) relies on before it ever
 * touches the database, so they are exercised in isolation.
 */
describe('AgentCommandService', () => {
  let service: AgentCommandService

  beforeEach(() => {
    service = new AgentCommandService()
  })

  describe('getCommandService', () => {
    it('returns a singleton instance', () => {
      const a = getCommandService()
      const b = getCommandService()
      expect(a).toBe(b)
      expect(a).toBeInstanceOf(AgentCommandService)
    })
  })

  describe('substituteVariables', () => {
    it('replaces a single {{variable}} token', () => {
      const result = service.substituteVariables('Base branch: {{baseBranch}}', {
        baseBranch: 'main',
      })
      expect(result).toBe('Base branch: main')
    })

    it('replaces multiple distinct variables', () => {
      const template = 'PR "{{prTitle}}" targeting {{baseBranch}}'
      const result = service.substituteVariables(template, {
        prTitle: 'Add new feature',
        baseBranch: 'main',
      })
      expect(result).toContain('Add new feature')
      expect(result).toContain('main')
      expect(result).toBe('PR "Add new feature" targeting main')
    })

    it('replaces every occurrence of the same variable (global)', () => {
      const result = service.substituteVariables('{{name}} = {{name}}', {
        name: 'x',
      })
      expect(result).toBe('x = x')
    })

    it('tolerates surrounding whitespace inside the braces', () => {
      const result = service.substituteVariables('Hello {{  who  }}', {
        who: 'world',
      })
      expect(result).toBe('Hello world')
    })

    it('coerces non-string values to strings', () => {
      const result = service.substituteVariables('n={{count}} b={{flag}}', {
        count: 42,
        flag: true,
      })
      expect(result).toBe('n=42 b=true')
    })

    it('leaves unknown tokens untouched', () => {
      const result = service.substituteVariables('{{a}} {{b}}', { a: '1' })
      expect(result).toBe('1 {{b}}')
    })
  })

  describe('validateVariables', () => {
    const requiredText: CommandVariable = {
      name: 'prTitle',
      label: 'PR Title',
      type: 'text',
      required: true,
    }

    it('passes when all required values are present', () => {
      const result = service.validateVariables([requiredText], {
        prTitle: 'A valid title',
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual({})
    })

    it('reports a missing required value', () => {
      const result = service.validateVariables([requiredText], {})
      expect(result.valid).toBe(false)
      expect(result.errors.prTitle).toContain('required')
    })

    it('treats empty string as missing for required fields', () => {
      const result = service.validateVariables([requiredText], { prTitle: '' })
      expect(result.valid).toBe(false)
      expect(result.errors.prTitle).toBeDefined()
    })

    it('validates number types', () => {
      const numberVar: CommandVariable = {
        name: 'count',
        label: 'Count',
        type: 'number',
        required: false,
      }
      expect(service.validateVariables([numberVar], { count: 5 }).valid).toBe(true)
      const bad = service.validateVariables([numberVar], { count: 'nope' })
      expect(bad.valid).toBe(false)
      expect(bad.errors.count).toContain('number')
    })

    it('validates select options', () => {
      const selectVar: CommandVariable = {
        name: 'branch',
        label: 'Branch',
        type: 'select',
        required: true,
        options: [
          { label: 'main', value: 'main' },
          { label: 'develop', value: 'develop' },
        ],
      }
      expect(service.validateVariables([selectVar], { branch: 'main' }).valid).toBe(true)
      const bad = service.validateVariables([selectVar], { branch: 'nonexistent' })
      expect(bad.valid).toBe(false)
      expect(bad.errors.branch).toBeDefined()
    })

    it('validates url types', () => {
      const urlVar: CommandVariable = {
        name: 'link',
        label: 'Link',
        type: 'url',
        required: false,
      }
      expect(service.validateVariables([urlVar], { link: 'https://x.com' }).valid).toBe(true)
      expect(service.validateVariables([urlVar], { link: 'not a url' }).valid).toBe(false)
    })

    it('enforces custom regex validation with the provided message', () => {
      const regexVar: CommandVariable = {
        name: 'prTitle',
        label: 'PR Title',
        type: 'text',
        required: true,
        validation: '^.{10,}$',
        validationMessage: 'PR title must be at least 10 characters',
      }
      const bad = service.validateVariables([regexVar], { prTitle: 'short' })
      expect(bad.valid).toBe(false)
      expect(bad.errors.prTitle).toBe('PR title must be at least 10 characters')

      const ok = service.validateVariables([regexVar], { prTitle: 'a long enough title' })
      expect(ok.valid).toBe(true)
    })

    it('skips validation for optional values that are omitted', () => {
      const optional: CommandVariable = {
        name: 'notes',
        label: 'Notes',
        type: 'text',
        required: false,
        validation: '^.{5,}$',
      }
      const result = service.validateVariables([optional], {})
      expect(result.valid).toBe(true)
    })
  })
})
