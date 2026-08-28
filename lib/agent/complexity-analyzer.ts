/**
 * Complexity Analyzer
 *
 * Analyzes PRD requirements and determines if chunking is needed
 * based on pages, features, and state complexity.
 *
 * #342 recalibration: the PRD parser only finds pages/features in STRUCTURED
 * PRDs — a raw idea ("a CRM with contacts, deals, and invoicing") parses to
 * near-zero counts, so requiresChunking never fired and every multi-feature
 * idea went single-shot. We now blend in the idea-level signals that already
 * gate multi-file output (#291/#293, lib/build/multifile-emphasis): named
 * surfaces + complex archetypes. A genuinely multi-FEATURE idea now routes to
 * the multi-pass planner; a terse archetype ("a dashboard") stays single-shot
 * multi-file (the proven cheaper path).
 */

import {
  detectIdeaSurfaces,
  hasExplicitMultiPageAsk,
  namesComplexArchetype,
} from '../build/multifile-emphasis'

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
  /** Distinct app surfaces the raw idea names (#342 — shared vocabulary with the multi-file gate). */
  ideaSurfaceCount: number
  /** True when the idea names a known complex archetype ("a CRM", "an admin panel"). */
  namesArchetype: boolean
  /**
   * True for a genuinely multi-FEATURE idea: an archetype fleshed out with 3+
   * named surfaces, 4+ distinct surfaces on their own, or an explicit
   * multi-page ask. This is what fires the multi-pass planner for raw ideas.
   */
  multiFeatureIdea: boolean
}

/**
 * Pages an archetype implies even when the idea is terse — "a CRM" has a list,
 * a detail view, filters, and settings whether or not the founder types them.
 * Used only to size the token estimate, not to force chunking on its own.
 */
const ARCHETYPE_IMPLIED_PAGES = 4

/**
 * Analyze PRD complexity and determine if chunking is needed
 */
export function analyzeComplexity(prdAnalysis: PRDAnalysis, prdText: string): ComplexityScore {
  const pageCount = prdAnalysis.pages.length
  const featureCount = prdAnalysis.features.length
  const componentCount = prdAnalysis.components.length

  // Idea-level signals (#342): the PRD parser under-counts raw ideas, so blend
  // in the surface/archetype vocabulary that already gates multi-file output.
  const ideaSurfaces = detectIdeaSurfaces(prdText)
  const ideaSurfaceCount = ideaSurfaces.length
  const namesArchetype = namesComplexArchetype(prdText)
  // Threshold note: archetype words often double as surface words ("analytics
  // dashboard" = 1 archetype + 2 surfaces), so archetype+2 was too twitchy —
  // it fired for terse ideas that belong on the cheap single-shot path. An
  // archetype needs 3+ named surfaces (i.e. features actually spelled out)
  // before multi-pass pays for itself.
  const multiFeatureIdea =
    hasExplicitMultiPageAsk(prdText) ||
    (namesArchetype && ideaSurfaceCount >= 3) ||
    ideaSurfaceCount >= 4

  // Effective counts: whichever is larger — what the parser found (structured
  // PRDs) or what the idea names (raw ideas).
  const effectivePageCount = Math.max(pageCount, namesArchetype ? ARCHETYPE_IMPLIED_PAGES : 0)
  const effectiveFeatureCount = Math.max(featureCount, ideaSurfaceCount)

  // Detect state complexity based on PRD content
  const stateComplexity = detectStateComplexity(prdText)

  // Calculate estimated tokens based on page count and features
  const estimatedTokens = estimateRequiredTokens(effectivePageCount, effectiveFeatureCount, componentCount, stateComplexity)

  // Determine overall complexity — a multi-feature idea is complex by
  // definition (many surfaces to build), even when the parser found nothing.
  const baseComplexity = determineOverallComplexity(effectivePageCount, effectiveFeatureCount, stateComplexity)
  const overallComplexity = multiFeatureIdea ? 'complex' : baseComplexity

  // Determine if chunking is required. #342: multi-feature ideas fire the
  // multi-pass planner; terse archetypes ("a dashboard") deliberately do NOT —
  // they stay on the cheaper single-shot multi-file path (#293).
  const requiresChunking = estimatedTokens > 10000 || effectivePageCount > 5 || multiFeatureIdea

  // Recommend chunking strategy
  let chunkingStrategy: ComplexityScore['chunkingStrategy'] = 'none'
  if (requiresChunking) {
    if (effectivePageCount <= 7) {
      chunkingStrategy = '3-phase'
    } else if (effectivePageCount <= 12) {
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
    ideaSurfaceCount,
    namesArchetype,
    multiFeatureIdea,
  }
}

/**
 * Augment a sparse PRD analysis with idea-derived pages/features so the chunk
 * planner has real material to plan with (#342). Without this, a raw
 * multi-feature idea reaches createChunkPlan with pages=[] and yields a
 * degenerate core+integration plan with ZERO feature phases.
 *
 * Only adds surfaces the parser did not already cover; leaves structured PRDs
 * (which parse rich page lists) untouched. Pure — returns a new object.
 */
export function augmentPRDAnalysisForChunking(
  prdAnalysis: PRDAnalysis,
  prdText: string,
): PRDAnalysis {
  const surfaces = detectIdeaSurfaces(prdText)
  if (surfaces.length === 0) return prdAnalysis

  const existingRoutes = new Set(prdAnalysis.pages.map((p) => p.route.toLowerCase()))
  const existingNames = new Set(prdAnalysis.pages.map((p) => p.name.toLowerCase()))

  const pages = [...prdAnalysis.pages]
  const features = [...prdAnalysis.features]
  const existingFeatures = new Set(features.map((f) => f.toLowerCase()))

  for (const surface of surfaces) {
    const route = '/' + surface.replace(/\s+/g, '-')
    const name = surface
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    if (existingRoutes.has(route) || existingNames.has(name.toLowerCase())) continue
    // Skip surfaces the parser already mapped under a different route name
    // (e.g. parser found "Dashboard (/)" and the surface is "dashboard").
    if ([...existingNames].some((n) => n.includes(surface))) continue
    pages.push({ name, route })
    existingRoutes.add(route)
    existingNames.add(name.toLowerCase())
    if (!existingFeatures.has(surface)) {
      features.push(name)
      existingFeatures.add(surface)
    }
  }

  return { ...prdAnalysis, pages, features }
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
  lines.push(`   Idea Surfaces: ${score.ideaSurfaceCount}${score.namesArchetype ? ' (names a complex archetype)' : ''}`)
  lines.push(`   Multi-feature Idea: ${score.multiFeatureIdea ? 'yes' : 'no'}`)
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
