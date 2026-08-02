import { describe, it, expect } from 'vitest'
import {
  substituteVariables,
  validateVariables,
} from '@/lib/validation/command-variables'
import type { CommandVariable } from '@/lib/types/agent-commands'

/**
 * The pure validation/substitution module is shared by both the server
 * AgentCommandService and the client variable-prompt dialog (Issue #17). It is
 * the browser-safe replacement that keeps the Drizzle/postgres driver out of
 * the client bundle, so it is tested independently of the service.
 */
describe('command-variables (shared pure module)', () => {
  describe('substituteVariables', () => {
    it('substitutes and coerces values, leaving unknown tokens intact', () => {
      const out = substituteVariables('{{a}}-{{n}}-{{missing}}', { a: 'x', n: 3 })
      expect(out).toBe('x-3-{{missing}}')
    })
  })

  describe('validateVariables', () => {
    it('flags a missing required variable', () => {
      const vars: CommandVariable[] = [
        { name: 'title', label: 'Title', type: 'text', required: true },
      ]
      const result = validateVariables(vars, {})
      expect(result.valid).toBe(false)
      expect(result.errors.title).toContain('required')
    })

    it('passes a fully valid multiselect', () => {
      const vars: CommandVariable[] = [
        {
          name: 'checks',
          label: 'Checks',
          type: 'multiselect',
          required: false,
          options: [
            { label: 'lint', value: 'lint' },
            { label: 'test', value: 'test' },
          ],
        },
      ]
      expect(validateVariables(vars, { checks: ['lint', 'test'] }).valid).toBe(true)
      expect(validateVariables(vars, { checks: ['nope'] }).valid).toBe(false)
    })
  })
})
