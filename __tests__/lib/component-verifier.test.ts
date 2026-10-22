import { describe, it, expect } from 'vitest'
import {
  extractComponentNames,
  verifyComponents,
  enhancePromptWithVerification,
  verifyAndEnhancePrompt,
} from '@/lib/component-verifier'

describe('extractComponentNames', () => {
  it('extracts components ending in a known suffix (Table, Form)', () => {
    const result = extractComponentNames('I need a DataTable and a UserForm')
    expect(result).toContain('DataTable')
    expect(result).toContain('UserForm')
    expect(result).toHaveLength(2)
  })

  it('extracts JSX-tag-like mentions via pattern (c)', () => {
    const result = extractComponentNames('Please render <CustomWidget> here')
    expect(result).toContain('CustomWidget')
  })

  it('extracts generic "Component" mentions via pattern (b)', () => {
    const result = extractComponentNames('Use MyComponent for this')
    expect(result).toContain('MyComponent')
  })

  it('returns [] when there are no matches', () => {
    const result = extractComponentNames('just a plain lowercase sentence with no matches')
    expect(result).toEqual([])
  })

  it('de-duplicates a component mentioned via multiple patterns', () => {
    const result = extractComponentNames('UserForm shown first, then as <UserForm> again')
    const occurrences = result.filter((c) => c === 'UserForm')
    expect(occurrences).toHaveLength(1)
  })
})

describe('verifyComponents', () => {
  it('a component present in AVAILABLE_COMPONENTS is valid, with no replacement', () => {
    const result = verifyComponents(['Button'])
    expect(result.valid).toEqual(['Button'])
    expect(result.invalid).toEqual([])
    expect(result.replacements).toEqual({})
  })

  it('an invalid component present in COMPONENT_REPLACEMENTS uses the explicit mapping', () => {
    const result = verifyComponents(['Form'])
    expect(result.invalid).toEqual(['Form'])
    expect(result.replacements['Form']).toBe('div with form styling')
  })

  it('explicit COMPONENT_REPLACEMENTS entry takes precedence over the generic Dialog/Modal fallback', () => {
    // AlertDialog is in the explicit map as 'Dialog component'. If the generic
    // fallback ran instead (it contains "Dialog"), it would produce
    // 'div with modal styling' — assert the explicit value wins.
    const result = verifyComponents(['AlertDialog'])
    expect(result.invalid).toEqual(['AlertDialog'])
    expect(result.replacements['AlertDialog']).toBe('Dialog component')
    expect(result.replacements['AlertDialog']).not.toBe('div with modal styling')
  })

  it('falls back to the generic Chart rule when not in the explicit map', () => {
    const result = verifyComponents(['RandomChart'])
    expect(result.invalid).toEqual(['RandomChart'])
    expect(result.replacements['RandomChart']).toBe('Card with div elements for chart visualization')
  })

  it('falls back to the generic Modal rule when not in the explicit map', () => {
    const result = verifyComponents(['RandomModal'])
    expect(result.invalid).toEqual(['RandomModal'])
    expect(result.replacements['RandomModal']).toBe('div with modal styling')
  })

  it('falls back to the final generic else when nothing else matches', () => {
    const result = verifyComponents(['WeirdWidget'])
    expect(result.invalid).toEqual(['WeirdWidget'])
    expect(result.replacements['WeirdWidget']).toBe('div with appropriate styling')
  })

  it('returns all-empty results for an empty array', () => {
    const result = verifyComponents([])
    expect(result).toEqual({ valid: [], invalid: [], replacements: {} })
  })

  it('separates a mix of valid and invalid components correctly', () => {
    const result = verifyComponents(['Button', 'Form', 'Card'])
    expect(result.valid.sort()).toEqual(['Button', 'Card'])
    expect(result.invalid).toEqual(['Form'])
  })
})

describe('enhancePromptWithVerification', () => {
  it('preserves the original message at the start of the returned string', () => {
    const original = 'Build me a nice dashboard'
    const verification = verifyComponents([])
    const enhanced = enhancePromptWithVerification(original, verification)
    expect(enhanced.startsWith(original)).toBe(true)
  })

  it('appends the IMPORTANT COMPONENT CONSTRAINTS section listing available components', () => {
    const verification = verifyComponents([])
    const enhanced = enhancePromptWithVerification('msg', verification)
    expect(enhanced).toContain('IMPORTANT COMPONENT CONSTRAINTS')
    expect(enhanced).toContain('Available Shadcn components: Button, Card,')
  })

  it('omits the COMPONENT REPLACEMENTS REQUIRED section when there are no invalid components', () => {
    const verification = verifyComponents(['Button', 'Card'])
    const enhanced = enhancePromptWithVerification('msg', verification)
    expect(enhanced).not.toContain('COMPONENT REPLACEMENTS REQUIRED')
  })

  it('includes the COMPONENT REPLACEMENTS REQUIRED section with each replacement line when invalid components exist', () => {
    const verification = verifyComponents(['Form', 'AlertDialog'])
    const enhanced = enhancePromptWithVerification('msg', verification)
    expect(enhanced).toContain('COMPONENT REPLACEMENTS REQUIRED:')
    expect(enhanced).toContain('- Replace "Form" with: div with form styling')
    expect(enhanced).toContain('- Replace "AlertDialog" with: Dialog component')
  })

  it('always appends the GENERATION RULES section', () => {
    const verification = verifyComponents([])
    const enhanced = enhancePromptWithVerification('msg', verification)
    expect(enhanced).toContain('GENERATION RULES:')
    expect(enhanced).toContain('1. Use components from the available list above')
  })
})

describe('verifyAndEnhancePrompt', () => {
  it('returns internally consistent extractedComponents, verification, and enhancedPrompt', () => {
    const message = 'Build me a dashboard with a DataTable and <CustomChart>'
    const result = verifyAndEnhancePrompt(message)

    const expectedExtracted = extractComponentNames(message)
    expect(result.extractedComponents.sort()).toEqual(expectedExtracted.sort())

    const expectedVerification = verifyComponents(expectedExtracted)
    expect(result.verification.valid.sort()).toEqual(expectedVerification.valid.sort())
    expect(result.verification.invalid.sort()).toEqual(expectedVerification.invalid.sort())
    expect(result.verification.replacements).toEqual(expectedVerification.replacements)

    expect(result.enhancedPrompt.startsWith(message)).toBe(true)
    expect(result.enhancedPrompt).toContain('IMPORTANT COMPONENT CONSTRAINTS')

    // DataTable and CustomChart are both invalid -> replacements section present
    expect(result.verification.invalid).toContain('DataTable')
    expect(result.verification.invalid).toContain('CustomChart')
    expect(result.enhancedPrompt).toContain('COMPONENT REPLACEMENTS REQUIRED:')
    expect(result.enhancedPrompt).toContain('- Replace "DataTable" with: Table')
    expect(result.enhancedPrompt).toContain(
      '- Replace "CustomChart" with: Card with div elements for chart visualization',
    )
  })

  it('handles a message with no component mentions', () => {
    const message = 'just build something simple please'
    const result = verifyAndEnhancePrompt(message)
    expect(result.extractedComponents).toEqual([])
    expect(result.verification).toEqual({ valid: [], invalid: [], replacements: {} })
    expect(result.enhancedPrompt).not.toContain('COMPONENT REPLACEMENTS REQUIRED')
  })
})
