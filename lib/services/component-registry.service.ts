/**
 * Component Registry Service
 * Maps user intents to pre-built AI Kit components to reduce token usage
 *
 * Token Savings Strategy:
 * - Before: Generate component from scratch (8,000 tokens)
 * - After: Reference existing component (1,500 tokens)
 * - Savings: 75-80% reduction
 */

export interface ComponentReference {
  name: string
  package: string
  description: string
  tokenSavings: number
  reusabilityScore: number
  useCases: string[]
  exampleUsage: string
}

/**
 * AI Kit Component Registry
 * Top components by reusability score from analysis
 */
export const AI_KIT_COMPONENTS: Record<string, ComponentReference> = {
  // Top Priority Components (95-98/100 reusability)
  streamingMessage: {
    name: 'StreamingMessage',
    package: '@ainative/ai-kit',
    description: 'AI message display with streaming, markdown, and code block support',
    tokenSavings: 2000,
    reusabilityScore: 95,
    useCases: ['chat', 'ai response', 'message display', 'streaming text'],
    exampleUsage: `<StreamingMessage
  content={aiResponse}
  isStreaming={isLoading}
  onComplete={() => console.log('Done')}
/>`,
  },

  codeBlock: {
    name: 'CodeBlock',
    package: '@ainative/ai-kit',
    description: 'Syntax-highlighted code block with copy button',
    tokenSavings: 1500,
    reusabilityScore: 95,
    useCases: ['code display', 'syntax highlighting', 'developer docs', 'tutorials'],
    exampleUsage: `<CodeBlock
  language="typescript"
  code={codeSnippet}
  showLineNumbers
  enableCopy
/>`,
  },

  streamingIndicator: {
    name: 'StreamingIndicator',
    package: '@ainative/ai-kit',
    description: 'Loading states with dots, pulse, and wave animations',
    tokenSavings: 800,
    reusabilityScore: 98,
    useCases: ['loading', 'streaming', 'progress', 'waiting state'],
    exampleUsage: `<StreamingIndicator
  type="wave"
  text="Generating response..."
/>`,
  },

  progressBar: {
    name: 'ProgressBar',
    package: '@ainative/ai-kit',
    description: 'Determinate/indeterminate progress bar with animations',
    tokenSavings: 600,
    reusabilityScore: 95,
    useCases: ['upload progress', 'task completion', 'loading bar'],
    exampleUsage: `<ProgressBar
  progress={uploadProgress}
  showLabel
  variant="gradient"
/>`,
  },

  usageDashboard: {
    name: 'UsageDashboard',
    package: '@ainative/ai-kit',
    description: 'Complete analytics dashboard with charts and metrics',
    tokenSavings: 5000,
    reusabilityScore: 85,
    useCases: ['analytics', 'dashboard', 'metrics', 'usage stats', 'admin panel'],
    exampleUsage: `<UsageDashboard
  data={analyticsData}
  timeRange="30d"
  showCharts
/>`,
  },
}

/**
 * Dashboard Starters from AI Kit
 */
export const DASHBOARD_STARTERS: Record<string, ComponentReference> = {
  usageAnalytics: {
    name: 'Usage Analytics Dashboard',
    package: '@ainative/dashboard-starters',
    description: 'Complete analytics dashboard with Next.js 14 (35+ tests)',
    tokenSavings: 8000,
    reusabilityScore: 90,
    useCases: ['analytics dashboard', 'usage tracking', 'admin analytics'],
    exampleUsage: 'Use as template: Copy from /packages/dashboard-starters/usage-analytics',
  },

  agentMonitor: {
    name: 'Agent Monitor Dashboard',
    package: '@ainative/dashboard-starters',
    description: 'Real-time agent monitoring with React 18 + Vite (35+ tests)',
    tokenSavings: 7500,
    reusabilityScore: 88,
    useCases: ['agent monitoring', 'real-time dashboard', 'system monitoring'],
    exampleUsage: 'Use as template: Copy from /packages/dashboard-starters/agent-monitor',
  },

  adminPanel: {
    name: 'Admin Panel',
    package: '@ainative/dashboard-starters',
    description: 'Full-featured admin panel with Next.js 14 (30+ tests)',
    tokenSavings: 7000,
    reusabilityScore: 87,
    useCases: ['admin panel', 'user management', 'system settings'],
    exampleUsage: 'Use as template: Copy from /packages/dashboard-starters/admin-panel',
  },
}

/**
 * Detect which components can be used based on user prompt
 */
export function detectApplicableComponents(prompt: string): ComponentReference[] {
  const lower = prompt.toLowerCase()
  const applicable: ComponentReference[] = []

  // Check AI Kit components
  Object.values(AI_KIT_COMPONENTS).forEach(component => {
    const matches = component.useCases.some(useCase =>
      lower.includes(useCase.toLowerCase())
    )
    if (matches) {
      applicable.push(component)
    }
  })

  // Check dashboard starters
  Object.values(DASHBOARD_STARTERS).forEach(starter => {
    const matches = starter.useCases.some(useCase =>
      lower.includes(useCase.toLowerCase())
    )
    if (matches) {
      applicable.push(starter)
    }
  })

  // Sort by reusability score (highest first)
  return applicable.sort((a, b) => b.reusabilityScore - a.reusabilityScore)
}

/**
 * Format component references for Claude prompt injection
 */
export function formatComponentsForPrompt(components: ComponentReference[]): string {
  if (components.length === 0) {
    return ''
  }

  const componentList = components
    .map(comp => `
**${comp.name}** (${comp.package})
- Description: ${comp.description}
- Token Savings: ~${comp.tokenSavings.toLocaleString()} tokens
- Use Cases: ${comp.useCases.join(', ')}
- Example:
\`\`\`jsx
${comp.exampleUsage}
\`\`\`
`)
    .join('\n')

  return `
## AVAILABLE PRE-BUILT COMPONENTS

Instead of generating these components from scratch, reference these AI Kit components to save ${components.reduce((sum, c) => sum + c.tokenSavings, 0).toLocaleString()} tokens:

${componentList}

**IMPORTANT:**
- When the user request matches a use case above, USE the pre-built component
- Focus your generation on CUSTOM business logic only
- Combine multiple AI Kit components to build complex UIs faster
- This reduces token usage by 75-80% and ensures consistent quality
`
}

/**
 * Calculate potential token savings
 */
export function calculateTokenSavings(components: ComponentReference[]): {
  totalSavings: number
  percentageSavings: number
  componentsUsed: number
} {
  const totalSavings = components.reduce((sum, c) => sum + c.tokenSavings, 0)
  const baselineCost = 8000 // Average tokens per generation without components
  const percentageSavings = Math.round((totalSavings / baselineCost) * 100)

  return {
    totalSavings,
    percentageSavings: Math.min(percentageSavings, 80), // Cap at 80%
    componentsUsed: components.length,
  }
}
