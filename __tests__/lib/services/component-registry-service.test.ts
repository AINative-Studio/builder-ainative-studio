import { describe, it, expect } from 'vitest'
import {
  AI_KIT_COMPONENTS,
  DASHBOARD_STARTERS,
  detectApplicableComponents,
  formatComponentsForPrompt,
  calculateTokenSavings,
  type ComponentReference,
} from '@/lib/services/component-registry.service'

/**
 * Unit tests for component-registry.service.ts: pure logic, no I/O. Maps
 * user prompts to pre-built AI Kit components / dashboard starters to
 * reduce codegen token usage.
 */

describe('detectApplicableComponents', () => {
  it('returns an empty array when no use cases match the prompt', async () => {
    const result = detectApplicableComponents('build a totally unrelated thing xyz123')
    expect(result).toEqual([])
  })

  it('matches an AI Kit component whose use case appears in the prompt', async () => {
    const result = detectApplicableComponents('I need a chat interface with streaming text')
    expect(result.some((c) => c.name === 'StreamingMessage')).toBe(true)
  })

  it('matches a dashboard starter whose use case appears in the prompt', async () => {
    const result = detectApplicableComponents('build an analytics dashboard for usage tracking')
    expect(result.some((c) => c.name === 'Usage Analytics Dashboard')).toBe(true)
  })

  it('is case-insensitive when matching use cases', async () => {
    const result = detectApplicableComponents('BUILD A CHAT INTERFACE')
    expect(result.some((c) => c.name === 'StreamingMessage')).toBe(true)
  })

  it('can match multiple components from a single prompt', async () => {
    const result = detectApplicableComponents(
      'build an admin panel with loading states and a progress bar for upload progress'
    )
    const names = result.map((c) => c.name)
    expect(names).toContain('ProgressBar')
    expect(names).toContain('Admin Panel')
  })

  it('sorts matched components by reusability score, highest first', async () => {
    const result = detectApplicableComponents(
      'build a chat with streaming text and also an admin panel for user management'
    )
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].reusabilityScore).toBeGreaterThanOrEqual(result[i].reusabilityScore)
    }
  })
})

describe('formatComponentsForPrompt', () => {
  it('returns an empty string when given no components', async () => {
    expect(formatComponentsForPrompt([])).toBe('')
  })

  it('includes each component name, package, description, and total token savings', async () => {
    const components: ComponentReference[] = [AI_KIT_COMPONENTS.streamingMessage, AI_KIT_COMPONENTS.codeBlock]
    const text = formatComponentsForPrompt(components)

    expect(text).toContain('AVAILABLE PRE-BUILT COMPONENTS')
    expect(text).toContain('StreamingMessage')
    expect(text).toContain('CodeBlock')
    expect(text).toContain('@ainative/ai-kit')
    // 2000 + 1500 = 3500, formatted with toLocaleString()
    expect(text).toContain('3,500')
  })

  it('includes the example usage snippet for each component', async () => {
    const text = formatComponentsForPrompt([AI_KIT_COMPONENTS.progressBar])
    expect(text).toContain('<ProgressBar')
  })
})

describe('calculateTokenSavings', () => {
  it('returns zero savings for an empty component list', async () => {
    const result = calculateTokenSavings([])
    expect(result).toEqual({ totalSavings: 0, percentageSavings: 0, componentsUsed: 0 })
  })

  it('sums tokenSavings across all provided components', async () => {
    const result = calculateTokenSavings([AI_KIT_COMPONENTS.streamingMessage, AI_KIT_COMPONENTS.codeBlock])
    expect(result.totalSavings).toBe(3500)
    expect(result.componentsUsed).toBe(2)
  })

  it('caps percentageSavings at 80 even when savings exceed the baseline', async () => {
    const result = calculateTokenSavings([
      DASHBOARD_STARTERS.usageAnalytics,
      DASHBOARD_STARTERS.agentMonitor,
      DASHBOARD_STARTERS.adminPanel,
    ])
    // 8000 + 7500 + 7000 = 22500, way more than the 8000 baseline.
    expect(result.percentageSavings).toBe(80)
  })

  it('computes a proportional percentage below the cap for smaller savings', async () => {
    const result = calculateTokenSavings([AI_KIT_COMPONENTS.progressBar]) // 600 tokens
    // 600 / 8000 * 100 = 7.5 -> rounds to 8
    expect(result.percentageSavings).toBe(8)
  })
})
