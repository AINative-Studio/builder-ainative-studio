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
 *
 * Issue #1201 follow-up: expanded past the original 2 happy-path tests to
 * cover every variable type and validation branch (number/boolean/select/
 * multiselect/url, custom regex, and the required/skip-when-absent paths).
 */
describe('command-variables (shared pure module)', () => {
  describe('substituteVariables', () => {
    it('substitutes and coerces values, leaving unknown tokens intact', () => {
      const out = substituteVariables('{{a}}-{{n}}-{{missing}}', { a: 'x', n: 3 })
      expect(out).toBe('x-3-{{missing}}')
    })

    it('replaces every occurrence of a repeated token', () => {
      const out = substituteVariables('{{x}} and {{x}} again', { x: 'y' })
      expect(out).toBe('y and y again')
    })

    it('tolerates whitespace inside the braces', () => {
      const out = substituteVariables('{{  spaced  }}', { spaced: 'ok' })
      expect(out).toBe('ok')
    })

    it('coerces booleans and numbers to their string form', () => {
      const out = substituteVariables('{{b}}/{{n}}', { b: true, n: 0 })
      expect(out).toBe('true/0')
    })

    it('returns the template unchanged when no values are provided', () => {
      expect(substituteVariables('no vars here', {})).toBe('no vars here')
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

    it.each([undefined, null, ''])(
      'flags a required variable whose value is %p',
      (value) => {
        const vars: CommandVariable[] = [
          { name: 'title', label: 'Title', type: 'text', required: true },
        ]
        const result = validateVariables(vars, { title: value as unknown as string })
        expect(result.valid).toBe(false)
      }
    )

    it('skips validation entirely when an optional variable is absent', () => {
      const vars: CommandVariable[] = [
        { name: 'nickname', label: 'Nickname', type: 'text', required: false },
      ]
      const result = validateVariables(vars, {})
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual({})
    })

    it('allows a falsy-but-present required value of 0 for a number type (only undefined/null/"" trip required)', () => {
      const vars: CommandVariable[] = [
        { name: 'count', label: 'Count', type: 'number', required: true },
      ]
      const result = validateVariables(vars, { count: 0 })
      expect(result.valid).toBe(true)
    })

    describe('number type', () => {
      const vars: CommandVariable[] = [
        { name: 'count', label: 'Count', type: 'number', required: false },
      ]

      it('accepts a valid numeric value, including numeric strings', () => {
        expect(validateVariables(vars, { count: 42 }).valid).toBe(true)
        expect(validateVariables(vars, { count: '42' }).valid).toBe(true)
      })

      it('rejects a non-numeric value', () => {
        const result = validateVariables(vars, { count: 'abc' })
        expect(result.valid).toBe(false)
        expect(result.errors.count).toBe('Count must be a number')
      })
    })

    describe('boolean type', () => {
      const vars: CommandVariable[] = [
        { name: 'enabled', label: 'Enabled', type: 'boolean', required: false },
      ]

      it('accepts true and false', () => {
        expect(validateVariables(vars, { enabled: true }).valid).toBe(true)
        expect(validateVariables(vars, { enabled: false }).valid).toBe(true)
      })

      it('rejects a non-boolean value like the string "true"', () => {
        const result = validateVariables(vars, { enabled: 'true' })
        expect(result.valid).toBe(false)
        expect(result.errors.enabled).toBe('Enabled must be true or false')
      })
    })

    describe('select type', () => {
      const vars: CommandVariable[] = [
        {
          name: 'env',
          label: 'Environment',
          type: 'select',
          required: false,
          options: [
            { label: 'Production', value: 'prod' },
            { label: 'Staging', value: 'staging' },
          ],
        },
      ]

      it('accepts a value matching one of the declared options', () => {
        expect(validateVariables(vars, { env: 'prod' }).valid).toBe(true)
      })

      it('rejects a value not among the declared options', () => {
        const result = validateVariables(vars, { env: 'dev' })
        expect(result.valid).toBe(false)
        expect(result.errors.env).toBe('Environment must be one of the available options')
      })

      it('skips the options check entirely when no options are declared', () => {
        const noOptionsVars: CommandVariable[] = [
          { name: 'env', label: 'Environment', type: 'select', required: false },
        ]
        expect(validateVariables(noOptionsVars, { env: 'anything' }).valid).toBe(true)
      })
    })

    describe('multiselect type', () => {
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

      it('passes a fully valid multiselect', () => {
        expect(validateVariables(vars, { checks: ['lint', 'test'] }).valid).toBe(true)
        expect(validateVariables(vars, { checks: ['nope'] }).valid).toBe(false)
      })

      it('rejects a non-array value outright', () => {
        const result = validateVariables(vars, { checks: 'lint' as unknown as string[] })
        expect(result.valid).toBe(false)
        expect(result.errors.checks).toBe('Checks must be an array')
      })

      it('reports invalid values with the same message regardless of how many are invalid', () => {
        const result = validateVariables(vars, { checks: ['lint', 'bogus', 'also-bogus'] })
        expect(result.valid).toBe(false)
        expect(result.errors.checks).toBe('Checks contains invalid values')
      })

      it('skips the options-membership check when no options are declared', () => {
        const noOptionsVars: CommandVariable[] = [
          { name: 'checks', label: 'Checks', type: 'multiselect', required: false },
        ]
        expect(validateVariables(noOptionsVars, { checks: ['anything'] }).valid).toBe(true)
      })
    })

    describe('url type', () => {
      const vars: CommandVariable[] = [
        { name: 'site', label: 'Site', type: 'url', required: false },
      ]

      it('accepts a well-formed URL', () => {
        expect(validateVariables(vars, { site: 'https://example.com' }).valid).toBe(true)
      })

      it('rejects a malformed URL', () => {
        const result = validateVariables(vars, { site: 'not a url' })
        expect(result.valid).toBe(false)
        expect(result.errors.site).toBe('Site must be a valid URL')
      })
    })

    describe('custom regex validation', () => {
      it('passes a value matching the declared validation regex', () => {
        const vars: CommandVariable[] = [
          {
            name: 'slug',
            label: 'Slug',
            type: 'text',
            required: false,
            validation: '^[a-z0-9-]+$',
          },
        ]
        expect(validateVariables(vars, { slug: 'my-slug-1' }).valid).toBe(true)
      })

      it('fails a value not matching the regex, using the default message', () => {
        const vars: CommandVariable[] = [
          {
            name: 'slug',
            label: 'Slug',
            type: 'text',
            required: false,
            validation: '^[a-z0-9-]+$',
          },
        ]
        const result = validateVariables(vars, { slug: 'Not A Slug!' })
        expect(result.valid).toBe(false)
        expect(result.errors.slug).toBe('Slug is invalid')
      })

      it('uses a custom validationMessage when provided', () => {
        const vars: CommandVariable[] = [
          {
            name: 'slug',
            label: 'Slug',
            type: 'text',
            required: false,
            validation: '^[a-z0-9-]+$',
            validationMessage: 'Slugs must be lowercase and hyphenated',
          },
        ]
        const result = validateVariables(vars, { slug: 'Nope' })
        expect(result.errors.slug).toBe('Slugs must be lowercase and hyphenated')
      })

      it('skips the regex check when the value is not a string (e.g. a number)', () => {
        const vars: CommandVariable[] = [
          {
            name: 'count',
            label: 'Count',
            type: 'number',
            required: false,
            validation: '^[a-z]+$',
          },
        ]
        // The number-type check passes (42 is numeric); the regex check is
        // skipped entirely because typeof value !== 'string'.
        expect(validateVariables(vars, { count: 42 }).valid).toBe(true)
      })
    })

    it('validates multiple variables independently and aggregates all errors', () => {
      const vars: CommandVariable[] = [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'count', label: 'Count', type: 'number', required: false },
      ]
      const result = validateVariables(vars, { count: 'abc' })

      expect(result.valid).toBe(false)
      expect(result.errors.title).toContain('required')
      expect(result.errors.count).toBe('Count must be a number')
    })
  })
})
