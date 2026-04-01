/**
 * Chunk Planner
 *
 * Takes PRD analysis and complexity score, generates a multi-phase
 * generation plan that breaks complex applications into manageable chunks.
 */

import { PRDAnalysis, ComplexityScore } from './complexity-analyzer'

export interface ChunkPhase {
  phaseNumber: 1 | 2 | 3
  phaseType: 'core' | 'feature' | 'integration'
  chunkId: string
  description: string
  prompt: string
  targetTokens: number
  dependencies: string[]
  includes: {
    pages?: string[]
    components?: string[]
    features?: string[]
  }
}

export interface ChunkPlan {
  totalPhases: number
  phases: ChunkPhase[]
  estimatedTotalTokens: number
  estimatedTime: string
}

/**
 * Create a chunk plan for complex application generation
 */
export function createChunkPlan(
  prdText: string,
  prdAnalysis: PRDAnalysis,
  complexityScore: ComplexityScore
): ChunkPlan {
  const phases: ChunkPhase[] = []

  // Phase 1: Core Structure (always first)
  phases.push(createCoreStructurePhase(prdText, prdAnalysis))

  // Phase 2: Feature Chunks (variable number based on complexity)
  const featureChunks = createFeatureChunks(prdText, prdAnalysis, complexityScore)
  phases.push(...featureChunks)

  // Phase 3: Integration (always last)
  phases.push(createIntegrationPhase(prdText, prdAnalysis, phases))

  const estimatedTotalTokens = phases.reduce((sum, p) => sum + p.targetTokens, 0)
  const estimatedMinutes = Math.ceil(phases.length * 2.5) // ~2.5 min per phase
  const estimatedTime = `${estimatedMinutes} minutes`

  return {
    totalPhases: phases.length,
    phases,
    estimatedTotalTokens,
    estimatedTime
  }
}

/**
 * Phase 1: Generate core application structure
 */
function createCoreStructurePhase(
  prdText: string,
  prdAnalysis: PRDAnalysis
): ChunkPhase {
  const allRoutes = prdAnalysis.pages.map(p => p.route).join(', ')

  // Extract data models from PRD
  const dataModels = extractDataModels(prdText)

  const prompt = `Generate the CORE STRUCTURE ONLY for this application.

IMPORTANT: Do NOT implement full page content yet. This phase focuses on architecture.

Include:
1. Root layout with navigation (sidebar/header as appropriate)
2. Global state management setup (Zustand or Context as needed)
3. TypeScript type definitions for data models: ${dataModels.join(', ')}
4. Mock data generators/fixtures for all models
5. Routing structure with EMPTY PLACEHOLDER pages for: ${allRoutes}
6. Shared component library (Button, Card, Modal, etc.)

Each route should have a basic page component that renders "Coming in Phase 2" text.

Target: 6,000-8,000 tokens.
Focus: Architecture, routing, types, mock data - NOT feature implementation.

${prdText}`

  return {
    phaseNumber: 1,
    phaseType: 'core',
    chunkId: 'phase-1-core',
    description: 'Core application structure, routing, types, and mock data',
    prompt,
    targetTokens: 7000,
    dependencies: [],
    includes: {
      pages: prdAnalysis.pages.map(p => `${p.route} (placeholder)`),
      components: ['Layout', 'Navigation', 'Shared UI Components']
    }
  }
}

/**
 * Phase 2: Generate feature chunks
 */
function createFeatureChunks(
  prdText: string,
  prdAnalysis: PRDAnalysis,
  complexityScore: ComplexityScore
): ChunkPhase[] {
  const chunks: ChunkPhase[] = []

  // Group pages into logical feature chunks (2-3 pages per chunk)
  const pageGroups = groupPagesIntoFeatures(prdAnalysis.pages)

  pageGroups.forEach((group, index) => {
    const chunkNumber = index + 1
    const pageRoutes = group.pages.map(p => p.route).join(', ')
    const pageNames = group.pages.map(p => p.name).join(', ')

    const prompt = `Generate the ${group.featureName} feature module.

CONTEXT FROM PHASE 1:
You have access to:
- Global types and interfaces (already defined)
- Mock data generators (already created)
- Layout and navigation (already built)
- Routing structure (placeholders exist)

YOUR TASK:
Implement FULL functionality for these pages: ${pageNames}

Pages to implement:
${group.pages.map(p => `- ${p.name} (${p.route})`).join('\n')}

Include:
1. Complete page implementations (replace placeholders)
2. Feature-specific components
3. Feature-specific hooks (if needed)
4. Use existing types and mock data from Phase 1
5. All UI states: loading, empty, error, success

DO NOT recreate layout, navigation, types, or mock data - those exist.
Focus ONLY on implementing these specific pages and their components.

Target: 4,000-6,000 tokens.

ORIGINAL PRD EXCERPT (for context):
${extractRelevantPRDSection(prdText, group.pages)}`

    chunks.push({
      phaseNumber: 2,
      phaseType: 'feature',
      chunkId: `phase-2-${chunkNumber}-${group.featureName.toLowerCase().replace(/\s+/g, '-')}`,
      description: `${group.featureName}: ${pageNames}`,
      prompt,
      targetTokens: 5000,
      dependencies: ['phase-1-core'],
      includes: {
        pages: group.pages.map(p => p.route),
        features: [group.featureName]
      }
    })
  })

  return chunks
}

/**
 * Phase 3: Integration and polish
 */
function createIntegrationPhase(
  prdText: string,
  prdAnalysis: PRDAnalysis,
  previousPhases: ChunkPhase[]
): ChunkPhase {
  const allChunkIds = previousPhases.map(p => p.chunkId)
  const allPages = prdAnalysis.pages.map(p => p.name).join(', ')

  const prompt = `FINAL INTEGRATION PASS for the complete application.

ALL MODULES GENERATED:
${previousPhases.filter(p => p.phaseType === 'feature').map(p => `- ${p.description}`).join('\n')}

YOUR TASK:
Connect everything together and add final polish.

1. Cross-module navigation
   - Ensure all links between features work correctly
   - Add "View Details" buttons that route between modules
   - Breadcrumbs where appropriate

2. Shared state connections
   - Connect features that share state
   - Ensure data flows correctly between pages

3. Global error handling
   - Add error boundaries for each major section
   - Consistent error UI across all features

4. Loading states
   - Ensure all async operations show loading UI
   - Skeleton screens where appropriate

5. Final polish
   - Consistent spacing and styling
   - Responsive breakpoints
   - Accessibility improvements (ARIA labels, keyboard nav)

6. Integration-specific features
   - Features that span multiple modules
   - Cross-cutting concerns

Target: 2,000-3,000 tokens.
Focus: Connections, polish, and cross-cutting features.

${prdText}`

  return {
    phaseNumber: 3,
    phaseType: 'integration',
    chunkId: 'phase-3-integration',
    description: 'Cross-module integration and final polish',
    prompt,
    targetTokens: 2500,
    dependencies: allChunkIds,
    includes: {
      features: ['Cross-module navigation', 'Error handling', 'Loading states', 'Final polish']
    }
  }
}

/**
 * Group pages into logical feature chunks
 */
function groupPagesIntoFeatures(pages: Array<{ name: string; route: string }>): Array<{
  featureName: string
  pages: Array<{ name: string; route: string }>
}> {
  const groups: Array<{ featureName: string; pages: typeof pages }> = []

  // Group by route prefix (e.g., /products/... goes together)
  const routeGroups = new Map<string, typeof pages>()

  pages.forEach(page => {
    // Extract main section from route (e.g., /products/categories -> products)
    const parts = page.route.split('/').filter(Boolean)
    const section = parts[0] || 'main'

    if (!routeGroups.has(section)) {
      routeGroups.set(section, [])
    }
    routeGroups.get(section)!.push(page)
  })

  // Convert to feature groups (max 3 pages per group)
  routeGroups.forEach((pages, section) => {
    // Split into sub-groups if more than 3 pages
    for (let i = 0; i < pages.length; i += 3) {
      const chunk = pages.slice(i, i + 3)
      const suffix = pages.length > 3 ? ` (Part ${Math.floor(i / 3) + 1})` : ''
      groups.push({
        featureName: capitalizeSection(section) + suffix,
        pages: chunk
      })
    }
  })

  return groups
}

/**
 * Extract data models mentioned in PRD
 */
function extractDataModels(prdText: string): string[] {
  const models: Set<string> = new Set()

  // Common patterns for data models
  const patterns = [
    /model[s]?:\s*([A-Z][a-zA-Z,\s]+)/gi,
    /interface[s]?:\s*([A-Z][a-zA-Z,\s]+)/gi,
    /type[s]?:\s*([A-Z][a-zA-Z,\s]+)/gi,
    /data:\s*([A-Z][a-zA-Z,\s]+)/gi,
  ]

  patterns.forEach(pattern => {
    const matches = prdText.matchAll(pattern)
    for (const match of matches) {
      const items = match[1].split(',').map(s => s.trim())
      items.forEach(item => {
        if (item && /^[A-Z]/.test(item)) {
          models.add(item)
        }
      })
    }
  })

  // Fallback: generic models if none found
  if (models.size === 0) {
    return ['User', 'Data', 'Settings']
  }

  return Array.from(models).slice(0, 8) // Max 8 models
}

/**
 * Extract relevant PRD section for a group of pages
 */
function extractRelevantPRDSection(
  prdText: string,
  pages: Array<{ name: string; route: string }>
): string {
  // Try to find sections mentioning these pages
  const pageNames = pages.map(p => p.name.toLowerCase())
  const lines = prdText.split('\n')

  const relevantLines: string[] = []
  let includeNext = 0

  lines.forEach(line => {
    const lowerLine = line.toLowerCase()

    // Check if line mentions any of our pages
    const isRelevant = pageNames.some(name => lowerLine.includes(name))

    if (isRelevant) {
      relevantLines.push(line)
      includeNext = 5 // Include next 5 lines for context
    } else if (includeNext > 0) {
      relevantLines.push(line)
      includeNext--
    }
  })

  // If we found relevant sections, return them, otherwise return first 500 chars
  if (relevantLines.length > 10) {
    return relevantLines.join('\n').slice(0, 2000)
  }

  return prdText.slice(0, 2000)
}

/**
 * Capitalize section name for display
 */
function capitalizeSection(section: string): string {
  return section
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Get human-readable chunk plan summary
 */
export function getChunkPlanSummary(plan: ChunkPlan): string {
  const lines: string[] = []

  lines.push(`📋 Generation Plan: ${plan.totalPhases} phases`)
  lines.push(`⏱️  Estimated time: ${plan.estimatedTime}`)
  lines.push(`🎯 Estimated tokens: ${plan.estimatedTotalTokens.toLocaleString()}`)
  lines.push(``)

  plan.phases.forEach((phase, index) => {
    const emoji = phase.phaseType === 'core' ? '🏗️' : phase.phaseType === 'feature' ? '✨' : '🔗'
    lines.push(`${emoji} Phase ${index + 1}: ${phase.description}`)
    lines.push(`   Target: ${phase.targetTokens.toLocaleString()} tokens`)
    if (phase.includes.pages && phase.includes.pages.length > 0) {
      lines.push(`   Pages: ${phase.includes.pages.join(', ')}`)
    }
  })

  return lines.join('\n')
}
