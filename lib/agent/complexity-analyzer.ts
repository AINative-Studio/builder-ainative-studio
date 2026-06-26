/**
 * Complexity Analyzer
 *
 * Analyzes PRD requirements and determines if chunking is needed
 * based on pages, features, and state complexity.
 */

export interface PRDAnalysis {
  pages: Array<{ name: string; route: string }>
  components: string[]
  features: string[]
  buildSteps: string[]
}

export interface ComplexityScore {
  pageCount: number
  featureCount: number
  componentCount: number
  stateComplexity: 'simple' | 'medium' | 'complex'
  overallComplexity: 'simple' | 'medium' | 'complex'
  estimatedTokens: number
  requiresChunking: boolean
  chunkingStrategy?: 'none' | '3-phase' | '4-phase' | '5-phase+'
  /** True when the request should be routed to the headless agent (Phase 4). */
  shouldUseAgent: boolean
}

/**
 * Analyze PRD complexity and determine if chunking is needed
 */
export function analyzeComplexity(prdAnalysis: PRDAnalysis, prdText: string): ComplexityScore {
  const pageCount = prdAnalysis.pages.length
  const featureCount = prdAnalysis.features.length
  const componentCount = prdAnalysis.components.length

  // Detect state complexity based on PRD content
  const stateComplexity = detectStateComplexity(prdText)

  // Calculate estimated tokens based on page count and features
  const estimatedTokens = estimateRequiredTokens(pageCount, featureCount, componentCount, stateComplexity)

  // Determine overall complexity
  const overallComplexity = determineOverallComplexity(pageCount, featureCount, stateComplexity)

  // Determine if chunking is required
  const requiresChunking = estimatedTokens > 10000 || pageCount > 5

  // Recommend chunking strategy
  let chunkingStrategy: ComplexityScore['chunkingStrategy'] = 'none'
  if (requiresChunking) {
    if (pageCount <= 7) {
      chunkingStrategy = '3-phase'
    } else if (pageCount <= 12) {
      chunkingStrategy = '4-phase'
    } else {
      chunkingStrategy = '5-phase+'
    }
  }

  // Route to the headless agent for complex or token-heavy requests
  const shouldUseAgent = overallComplexity === 'complex' || estimatedTokens > 5000

  return {
    pageCount,
    featureCount,
    componentCount,
    stateComplexity,
    overallComplexity,
    estimatedTokens,
    requiresChunking,
    chunkingStrategy,
    shouldUseAgent,
  }
}

/**
 * Detect state management complexity from PRD text
 */
function detectStateComplexity(prdText: string): 'simple' | 'medium' | 'complex' {
  const lowerText = prdText.toLowerCase()

  // Complex indicators
  const hasZustand = lowerText.includes('zustand') || lowerText.includes('global state')
  const hasReactQuery = lowerText.includes('react query') || lowerText.includes('tanstack query')
  const hasForms = lowerText.includes('form') && (lowerText.includes('validation') || lowerText.includes('react hook form'))
  const hasRealtime = lowerText.includes('real-time') || lowerText.includes('websocket')

  const complexIndicators = [hasZustand, hasReactQuery, hasForms, hasRealtime].filter(Boolean).length

  if (complexIndicators >= 2) return 'complex'
  if (complexIndicators === 1) return 'medium'
  return 'simple'
}

/**
 * Estimate required tokens based on application complexity
 */
function estimateRequiredTokens(
  pageCount: number,
  featureCount: number,
  componentCount: number,
  stateComplexity: 'simple' | 'medium' | 'complex'
): number {
  // Base tokens per page
  const tokensPerPage = 1500

  // Base tokens per feature
  const tokensPerFeature = 800

  // Base tokens per component
  const tokensPerComponent = 400

  // State complexity multiplier
  const stateMultiplier = {
    simple: 1.0,
    medium: 1.2,
    complex: 1.5
  }[stateComplexity]

  // Calculate base tokens
  const baseTokens = (
    (pageCount * tokensPerPage) +
    (featureCount * tokensPerFeature) +
    (componentCount * tokensPerComponent)
  )

  // Apply state complexity multiplier
  const estimatedTokens = Math.round(baseTokens * stateMultiplier)

  return estimatedTokens
}

/**
 * Determine overall complexity category
 */
function determineOverallComplexity(
  pageCount: number,
  featureCount: number,
  stateComplexity: 'simple' | 'medium' | 'complex'
): 'simple' | 'medium' | 'complex' {
  // Complex if: 8+ pages OR 8+ features OR complex state
  if (pageCount >= 8 || featureCount >= 8 || stateComplexity === 'complex') {
    return 'complex'
  }

  // Medium if: 4-7 pages OR 4-7 features OR medium state
  if (pageCount >= 4 || featureCount >= 4 || stateComplexity === 'medium') {
    return 'medium'
  }

  return 'simple'
}

/**
 * Get human-readable complexity report
 */
export function getComplexityReport(score: ComplexityScore): string {
  const lines: string[] = []

  lines.push(`📊 Complexity Analysis:`)
  lines.push(`   Pages: ${score.pageCount}`)
  lines.push(`   Features: ${score.featureCount}`)
  lines.push(`   Components: ${score.componentCount}`)
  lines.push(`   State Complexity: ${score.stateComplexity}`)
  lines.push(`   Overall: ${score.overallComplexity}`)
  lines.push(`   Estimated Tokens: ${score.estimatedTokens.toLocaleString()}`)

  if (score.requiresChunking) {
    lines.push(``)
    lines.push(`⚠️  Application exceeds single-pass token limit`)
    lines.push(`   Strategy: ${score.chunkingStrategy}`)
    lines.push(`   Will generate in multiple phases`)
  } else {
    lines.push(``)
    lines.push(`✅ Application can be generated in single pass`)
  }

  return lines.join('\n')
}

/**
 * Get recommended chunk count based on complexity
 */
export function getRecommendedChunkCount(score: ComplexityScore): number {
  if (!score.requiresChunking) return 1

  // Calculate feature chunks needed
  // Each feature chunk should target 4,000-6,000 tokens
  const targetTokensPerChunk = 5000
  const coreStructureTokens = 7000  // Phase 1
  const integrationTokens = 2500     // Phase 3 (final)

  const remainingTokens = score.estimatedTokens - coreStructureTokens - integrationTokens
  const featureChunks = Math.ceil(remainingTokens / targetTokensPerChunk)

  // Total chunks = 1 (core) + N (features) + 1 (integration)
  return 1 + Math.max(1, featureChunks) + 1
}
