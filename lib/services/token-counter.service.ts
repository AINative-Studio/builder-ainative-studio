/**
 * Token Counter Service (US-033)
 *
 * Manages token budgets for LLM prompts to stay within context window limits.
 * Uses approximate tokenization based on GPT tokenizer estimation.
 */

import { logger } from '../logger'

// Token budget configuration
export const TOKEN_BUDGET = {
  MAX_TOKENS: 4000, // Maximum tokens for entire prompt
  RESERVED: {
    USER_PROMPT: 1000, // Reserve at least 1000 tokens for user prompt
    CONSTRAINTS: 500, // Reserve for constraints section
    DESIGN_TOKENS: 300, // Reserve for design tokens
    FEW_SHOT_MIN: 200, // Minimum tokens for at least 1 example
    COMPONENT_DOCS_MIN: 100 // Minimum tokens for critical component docs
  }
}

export interface TokenBudget {
  userPrompt: number
  constraints: number
  designTokens: number
  fewShotExamples: number
  componentDocs: number
  total: number
}

export interface TruncationResult {
  truncated: boolean
  original: number
  final: number
  sectionsRemoved: string[]
  sectionsKept: string[]
}

/**
 * Estimate token count for text
 * Uses approximation: ~4 characters per token (GPT-3/4 average)
 *
 * @param text Text to count tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  if (!text) return 0

  // Remove extra whitespace for more accurate counting
  const cleanedText = text.replace(/\s+/g, ' ').trim()

  // Approximation: 1 token ≈ 4 characters
  // Add 10% buffer for special tokens and encoding overhead
  const estimate = Math.ceil((cleanedText.length / 4) * 1.1)

  return estimate
}

/**
 * Calculate token budget for prompt sections
 *
 * @param sections Prompt sections to calculate budget for
 * @returns Token budget breakdown
 */
export function calculateTokenBudget(sections: {
  userPrompt: string
  constraints: string
  designTokens?: string
  fewShotExamples?: string
  componentDocs?: string
}): TokenBudget {
  const budget: TokenBudget = {
    userPrompt: estimateTokens(sections.userPrompt),
    constraints: estimateTokens(sections.constraints),
    designTokens: estimateTokens(sections.designTokens || ''),
    fewShotExamples: estimateTokens(sections.fewShotExamples || ''),
    componentDocs: estimateTokens(sections.componentDocs || ''),
    total: 0
  }

  budget.total =
    budget.userPrompt +
    budget.constraints +
    budget.designTokens +
    budget.fewShotExamples +
    budget.componentDocs

  return budget
}

/**
 * Truncate prompt sections to fit within token budget
 *
 * Priority order (highest to lowest):
 * 1. User prompt (never truncate)
 * 2. Constraints (never truncate)
 * 3. Design tokens (never truncate)
 * 4. Few-shot examples (truncate if needed - keep top 1-2)
 * 5. Component docs (truncate if needed - keep only critical)
 *
 * @param sections Prompt sections
 * @returns Truncated sections and metadata
 */
export function truncateToTokenBudget(sections: {
  userPrompt: string
  constraints: string
  designTokens?: string
  fewShotExamples?: string
  componentDocs?: string
}): {
  sections: typeof sections
  truncation: TruncationResult
} {
  const originalBudget = calculateTokenBudget(sections)
  const sectionsRemoved: string[] = []
  const sectionsKept: string[] = ['userPrompt', 'constraints']

  // If under budget, return as-is
  if (originalBudget.total <= TOKEN_BUDGET.MAX_TOKENS) {
    if (sections.designTokens) sectionsKept.push('designTokens')
    if (sections.fewShotExamples) sectionsKept.push('fewShotExamples')
    if (sections.componentDocs) sectionsKept.push('componentDocs')

    return {
      sections,
      truncation: {
        truncated: false,
        original: originalBudget.total,
        final: originalBudget.total,
        sectionsRemoved,
        sectionsKept
      }
    }
  }

  // Need to truncate - start with a copy
  const truncatedSections = { ...sections }
  let currentTotal = originalBudget.total

  // Calculate available budget for optional sections
  const reservedTokens =
    originalBudget.userPrompt +
    originalBudget.constraints +
    originalBudget.designTokens

  const availableForOptional = TOKEN_BUDGET.MAX_TOKENS - reservedTokens

  // Priority 1: Keep design tokens (if they exist and fit)
  if (sections.designTokens) {
    sectionsKept.push('designTokens')
  }

  // Priority 2: Truncate few-shot examples if needed
  if (sections.fewShotExamples && originalBudget.fewShotExamples > 0) {
    const exampleBudget = Math.max(
      TOKEN_BUDGET.RESERVED.FEW_SHOT_MIN,
      Math.floor(availableForOptional * 0.6) // 60% of available budget
    )

    if (originalBudget.fewShotExamples > exampleBudget) {
      // Truncate examples - keep approximately top 1-2 examples
      const exampleLines = sections.fewShotExamples.split('\n')
      const targetLength = Math.floor(
        (exampleBudget / originalBudget.fewShotExamples) * exampleLines.length
      )

      truncatedSections.fewShotExamples = exampleLines
        .slice(0, Math.max(targetLength, 10)) // Keep at least 10 lines
        .join('\n')

      const tokensSaved =
        originalBudget.fewShotExamples -
        estimateTokens(truncatedSections.fewShotExamples)
      currentTotal -= tokensSaved

      logger.warn('Few-shot examples truncated', {
        original: originalBudget.fewShotExamples,
        final: estimateTokens(truncatedSections.fewShotExamples),
        tokensSaved
      })
    }
    sectionsKept.push('fewShotExamples')
  }

  // Priority 3: Truncate or remove component docs if still over budget
  if (sections.componentDocs && currentTotal > TOKEN_BUDGET.MAX_TOKENS) {
    const remainingBudget = TOKEN_BUDGET.MAX_TOKENS - (currentTotal - originalBudget.componentDocs)

    if (remainingBudget >= TOKEN_BUDGET.RESERVED.COMPONENT_DOCS_MIN) {
      // Truncate component docs to fit remaining budget
      const docLines = sections.componentDocs.split('\n')
      const targetLength = Math.floor(
        (remainingBudget / originalBudget.componentDocs) * docLines.length
      )

      truncatedSections.componentDocs = docLines
        .slice(0, Math.max(targetLength, 5)) // Keep at least 5 lines
        .join('\n')

      const tokensSaved =
        originalBudget.componentDocs -
        estimateTokens(truncatedSections.componentDocs)
      currentTotal -= tokensSaved

      logger.warn('Component docs truncated', {
        original: originalBudget.componentDocs,
        final: estimateTokens(truncatedSections.componentDocs),
        tokensSaved
      })
      sectionsKept.push('componentDocs')
    } else {
      // Remove component docs entirely
      truncatedSections.componentDocs = undefined
      currentTotal -= originalBudget.componentDocs
      sectionsRemoved.push('componentDocs')

      logger.warn('Component docs removed entirely', {
        tokensSaved: originalBudget.componentDocs
      })
    }
  } else if (sections.componentDocs) {
    sectionsKept.push('componentDocs')
  }

  const finalBudget = calculateTokenBudget(truncatedSections)

  return {
    sections: truncatedSections,
    truncation: {
      truncated: true,
      original: originalBudget.total,
      final: finalBudget.total,
      sectionsRemoved,
      sectionsKept
    }
  }
}

/**
 * Format token budget for logging
 *
 * @param budget Token budget breakdown
 * @returns Formatted string
 */
export function formatTokenBudget(budget: TokenBudget): string {
  return `Total: ${budget.total}/${TOKEN_BUDGET.MAX_TOKENS} tokens (User: ${budget.userPrompt}, Constraints: ${budget.constraints}, Tokens: ${budget.designTokens}, Examples: ${budget.fewShotExamples}, Docs: ${budget.componentDocs})`
}
