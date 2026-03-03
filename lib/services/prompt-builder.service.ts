/**
 * Prompt Builder Service (Epic 4)
 *
 * Orchestrates all prompt enhancement features:
 * - Language detection and translation (US-034)
 * - Intent detection (US-032)
 * - Few-shot example selection (US-029)
 * - Component documentation injection (US-030)
 * - Token budget management (US-033)
 * - Constraint enforcement (US-031)
 */

import { logger } from '../logger'
import { detectAndTranslate, type SupportedLanguage } from './translation.service'
import { detectUIType, getExampleCategory, type UIType } from './intent-detector.service'
import {
  selectExamplesBySimilarity,
  formatExamplesForPrompt
} from './example-selector.service'
import {
  truncateToTokenBudget,
  formatTokenBudget,
  calculateTokenBudget
} from './token-counter.service'
import {
  detectApplicableComponents,
  formatComponentsForPrompt,
  calculateTokenSavings
} from './component-registry.service'
import type { DesignTokensResponse } from '../mcp/design-system-client'
import componentDocsData from '../data/component-docs.json'

export interface EnhancedPromptResult {
  enhancedPrompt: string
  systemPrompt: string
  metadata: {
    originalLanguage: SupportedLanguage
    wasTranslated: boolean
    detectedUIType: UIType
    uiTypeConfidence: number
    examplesCount: number
    examplesMethod: 'semantic' | 'fallback'
    componentDocsInjected: number
    aiKitComponentsDetected: number
    tokenSavingsEstimate: number
    tokenBudget: {
      total: number
      breakdown: string
    }
    wasTruncated: boolean
    processingTimeMs: number
  }
}

/**
 * Build constraints section for the prompt
 */
function buildConstraintsSection(): string {
  return `
CRITICAL CONSTRAINTS:

🚫 NEVER use inline styles - ALWAYS use Tailwind utility classes
✅ USE ONLY these components: Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Input, Label, Badge, Avatar, AvatarImage, AvatarFallback, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Separator
📦 DO NOT import any components - all are globally available
🎨 FOLLOW the design system colors and tokens EXACTLY as provided
♿ ENSURE accessibility with proper ARIA labels and keyboard navigation
🔧 MAKE ALL UI ELEMENTS FUNCTIONAL with useState, onClick, onChange handlers
📱 CREATE RESPONSIVE layouts that work on mobile, tablet, and desktop
🎯 FOLLOW the user's requirements PRECISELY - they are the primary driver

TECHNICAL RULES:
- Wrap code in triple backticks with 'jsx' or 'javascript' language tag
- No import statements needed - useState, useEffect are globally available
- Create self-contained component functions with real interactivity
- Include event handlers for all interactive elements
- Use realistic, contextually appropriate data
`
}

/**
 * Extract component names mentioned in prompt
 *
 * @param prompt User prompt
 * @returns Array of component names found
 */
function extractComponentNames(prompt: string): string[] {
  const availableComponents = [
    'Button',
    'Card',
    'CardHeader',
    'CardTitle',
    'CardDescription',
    'CardContent',
    'CardFooter',
    'Input',
    'Label',
    'Badge',
    'Avatar',
    'AvatarImage',
    'AvatarFallback',
    'Table',
    'TableHeader',
    'TableBody',
    'TableRow',
    'TableHead',
    'TableCell',
    'Separator'
  ]

  const lowerPrompt = prompt.toLowerCase()
  const mentioned: string[] = []

  for (const component of availableComponents) {
    // Check for component name (case-insensitive)
    const componentLower = component.toLowerCase()
    if (lowerPrompt.includes(componentLower)) {
      mentioned.push(component)
    }
  }

  return mentioned
}

/**
 * Build component documentation section
 * Only includes docs for components mentioned in the prompt
 *
 * @param prompt User prompt
 * @returns Component docs text
 */
function buildComponentDocsSection(prompt: string): string {
  const mentionedComponents = extractComponentNames(prompt)

  if (mentionedComponents.length === 0) {
    // If no specific components mentioned, return empty
    // The LLM knows about all components from the base prompt
    return ''
  }

  const docs = componentDocsData.components.filter(comp =>
    mentionedComponents.includes(comp.name)
  )

  if (docs.length === 0) {
    return ''
  }

  const formattedDocs = docs.map(comp => {
    return `
COMPONENT: ${comp.name}
Props: ${JSON.stringify(comp.props, null, 2)}
Usage: ${comp.usage}
Do's: ${comp.dos.map(d => `  - ${d}`).join('\n')}
Don'ts: ${comp.donts.map(d => `  - ${d}`).join('\n')}
`
  })

  return `
COMPONENT DOCUMENTATION:
Only use components mentioned below. Follow their usage patterns exactly.

${formattedDocs.join('\n---\n')}
`
}

/**
 * Build design tokens section
 *
 * @param tokens Design tokens
 * @returns Design tokens text
 */
function buildDesignTokensSection(tokens?: DesignTokensResponse | null): string {
  if (!tokens) {
    return ''
  }

  return `
DESIGN SYSTEM TOKENS:
Use these design tokens EXACTLY as specified. Do not deviate from these colors and styles.

Colors:
${Object.entries(tokens.light.colors || {})
    .map(([key, value]) => `  ${key}: ${value}`)
    .join('\n')}

Typography:
${Object.entries(tokens.light.typography || {})
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
    .join('\n')}

Spacing:
${Object.entries(tokens.light.spacing || {})
    .map(([key, value]) => `  ${key}: ${value}`)
    .join('\n')}

IMPORTANT: Use these exact color values in your Tailwind classes.
`
}

/**
 * Build enhanced prompt with all enhancements
 *
 * @param userPrompt User's original prompt
 * @param designTokens Optional design tokens
 * @returns Enhanced prompt result
 */
export async function buildEnhancedPrompt(
  userPrompt: string,
  designTokens?: DesignTokensResponse | null
): Promise<EnhancedPromptResult> {
  const startTime = Date.now()

  try {
    // Step 1: Language detection and translation (US-034)
    logger.info('Step 1: Detecting and translating prompt')
    const translation = await detectAndTranslate(userPrompt)
    const workingPrompt = translation.translatedText

    logger.info('Translation result', {
      language: translation.language,
      wasTranslated: translation.wasTranslated,
      confidence: translation.confidence
    })

    // Step 2: Intent detection (US-032)
    logger.info('Step 2: Detecting UI type intent')
    const intentDetection = detectUIType(workingPrompt)

    logger.info('Intent detection result', {
      type: intentDetection.type,
      confidence: intentDetection.confidence,
      keywords: intentDetection.keywords
    })

    // Step 3: Select few-shot examples (US-029)
    logger.info('Step 3: Selecting few-shot examples')
    const exampleCategory = getExampleCategory(intentDetection.type)
    const exampleSelection = await selectExamplesBySimilarity(
      workingPrompt,
      exampleCategory
    )

    logger.info('Example selection result', {
      count: exampleSelection.examples.length,
      method: exampleSelection.method,
      timeMs: exampleSelection.selectionTimeMs
    })

    // Step 4: Detect applicable AI Kit components
    logger.info('Step 4: Detecting applicable AI Kit components')
    const applicableComponents = detectApplicableComponents(workingPrompt)
    const componentLibrarySection = formatComponentsForPrompt(applicableComponents)
    const tokenSavings = calculateTokenSavings(applicableComponents)

    logger.info('AI Kit component detection result', {
      componentsDetected: applicableComponents.length,
      estimatedSavings: tokenSavings.totalSavings,
      percentageSavings: tokenSavings.percentageSavings
    })

    // Step 5: Build prompt sections
    logger.info('Step 5: Building prompt sections')

    const constraintsSection = buildConstraintsSection()
    const componentDocsSection = buildComponentDocsSection(workingPrompt)
    const designTokensSection = buildDesignTokensSection(designTokens)
    const fewShotSection = formatExamplesForPrompt(exampleSelection.examples)
    const intentSection = intentDetection.typeSpecificInstructions

    // Combine user prompt with intent-specific instructions
    const enhancedUserPrompt = intentSection
      ? `${workingPrompt}\n\n${intentSection}`
      : workingPrompt

    // Step 6: Token budget management (US-033)
    logger.info('Step 6: Managing token budget')

    const sections = {
      userPrompt: enhancedUserPrompt,
      constraints: constraintsSection,
      aiKitComponents: componentLibrarySection,
      designTokens: designTokensSection,
      fewShotExamples: fewShotSection,
      componentDocs: componentDocsSection
    }

    const budgetResult = truncateToTokenBudget(sections)
    const finalBudget = calculateTokenBudget(budgetResult.sections)

    if (budgetResult.truncation.truncated) {
      logger.warn('Prompt truncated to fit token budget', {
        original: budgetResult.truncation.original,
        final: budgetResult.truncation.final,
        sectionsRemoved: budgetResult.truncation.sectionsRemoved,
        sectionsKept: budgetResult.truncation.sectionsKept
      })
    }

    // Step 7: Build final system prompt
    const systemPromptParts = [
      budgetResult.sections.constraints,
      budgetResult.sections.aiKitComponents,
      budgetResult.sections.designTokens,
      budgetResult.sections.componentDocs,
      budgetResult.sections.fewShotExamples
    ].filter(Boolean)

    const systemPrompt = systemPromptParts.join('\n\n---\n\n')
    const enhancedPrompt = budgetResult.sections.userPrompt

    const processingTimeMs = Date.now() - startTime

    logger.info('Prompt enhancement completed', {
      processingTimeMs,
      tokenBudget: formatTokenBudget(finalBudget)
    })

    return {
      enhancedPrompt,
      systemPrompt,
      metadata: {
        originalLanguage: translation.language,
        wasTranslated: translation.wasTranslated,
        detectedUIType: intentDetection.type,
        uiTypeConfidence: intentDetection.confidence,
        examplesCount: exampleSelection.examples.length,
        examplesMethod: exampleSelection.method,
        componentDocsInjected: componentDocsSection ? extractComponentNames(workingPrompt).length : 0,
        aiKitComponentsDetected: applicableComponents.length,
        tokenSavingsEstimate: tokenSavings.totalSavings,
        tokenBudget: {
          total: finalBudget.total,
          breakdown: formatTokenBudget(finalBudget)
        },
        wasTruncated: budgetResult.truncation.truncated,
        processingTimeMs
      }
    }
  } catch (error) {
    logger.error('Prompt enhancement failed', { error })

    // Fallback: return minimal enhancement
    return {
      enhancedPrompt: userPrompt,
      systemPrompt: buildConstraintsSection(),
      metadata: {
        originalLanguage: 'en',
        wasTranslated: false,
        detectedUIType: 'unknown',
        uiTypeConfidence: 0,
        examplesCount: 0,
        examplesMethod: 'fallback',
        componentDocsInjected: 0,
        aiKitComponentsDetected: 0,
        tokenSavingsEstimate: 0,
        tokenBudget: {
          total: 0,
          breakdown: 'Error occurred'
        },
        wasTruncated: false,
        processingTimeMs: Date.now() - startTime
      }
    }
  }
}
