import Anthropic from '@anthropic-ai/sdk'

/**
 * Memory API Service (US-024)
 *
 * Manages conversation context using Claude's Memory API for:
 * - Design preferences and token caching
 * - User's component history
 * - Iterative refinements
 */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export interface ConversationMemory {
  chatId: string
  designPreferences?: {
    colorScheme?: string[]
    typography?: string
    spacing?: string
  }
  componentHistory: Array<{
    prompt: string
    component: string
    timestamp: number
  }>
  userFeedback: Array<{
    issue: string
    resolution: string
    timestamp: number
  }>
}

// In-memory store (replace with database in production)
const memoryStore = new Map<string, ConversationMemory>()

/**
 * Initialize or get conversation memory
 */
export function getConversationMemory(chatId: string): ConversationMemory {
  if (!memoryStore.has(chatId)) {
    memoryStore.set(chatId, {
      chatId,
      componentHistory: [],
      userFeedback: [],
    })
  }
  return memoryStore.get(chatId)!
}

/**
 * Update conversation memory with new component
 */
export function addComponentToMemory(
  chatId: string,
  prompt: string,
  component: string
): void {
  const memory = getConversationMemory(chatId)
  memory.componentHistory.push({
    prompt,
    component,
    timestamp: Date.now(),
  })
}

/**
 * Update design preferences from component generation
 */
export function updateDesignPreferences(
  chatId: string,
  preferences: ConversationMemory['designPreferences']
): void {
  const memory = getConversationMemory(chatId)
  memory.designPreferences = {
    ...memory.designPreferences,
    ...preferences,
  }
}

/**
 * Add user feedback to memory
 */
export function addUserFeedback(
  chatId: string,
  issue: string,
  resolution: string
): void {
  const memory = getConversationMemory(chatId)
  memory.userFeedback.push({
    issue,
    resolution,
    timestamp: Date.now(),
  })
}

/**
 * Format memory for Claude prompt injection
 *
 * Converts conversation history into a structured prompt section
 * that helps Claude maintain context across messages
 */
export function formatMemoryForPrompt(chatId: string): string {
  const memory = getConversationMemory(chatId)

  let memoryPrompt = '\n## CONVERSATION CONTEXT\n\n'

  // Add design preferences if available
  if (memory.designPreferences) {
    memoryPrompt += '**User Design Preferences:**\n'
    if (memory.designPreferences.colorScheme) {
      memoryPrompt += `- Color Scheme: ${memory.designPreferences.colorScheme.join(', ')}\n`
    }
    if (memory.designPreferences.typography) {
      memoryPrompt += `- Typography: ${memory.designPreferences.typography}\n`
    }
    if (memory.designPreferences.spacing) {
      memoryPrompt += `- Spacing: ${memory.designPreferences.spacing}\n`
    }
    memoryPrompt += '\n'
  }

  // Add recent component history (last 3 components)
  if (memory.componentHistory.length > 0) {
    memoryPrompt += '**Recent Component History:**\n'
    const recentComponents = memory.componentHistory.slice(-3)
    recentComponents.forEach((comp, idx) => {
      memoryPrompt += `${idx + 1}. User asked for: "${comp.prompt}"\n`
      memoryPrompt += `   Component type: ${extractComponentType(comp.component)}\n`
    })
    memoryPrompt += '\n'
  }

  // Add user feedback patterns
  if (memory.userFeedback.length > 0) {
    memoryPrompt += '**User Feedback Patterns:**\n'
    const recentFeedback = memory.userFeedback.slice(-3)
    recentFeedback.forEach((fb, idx) => {
      memoryPrompt += `${idx + 1}. Issue: ${fb.issue} → Resolution: ${fb.resolution}\n`
    })
    memoryPrompt += '\n'
  }

  memoryPrompt += '**IMPORTANT:** Use this context to maintain consistency with user preferences and avoid repeating previous mistakes.\n\n'

  return memoryPrompt
}

/**
 * Extract component type from code (for memory tracking)
 */
function extractComponentType(code: string): string {
  // Extract function name or component type
  const functionMatch = code.match(/function\s+(\w+)/)
  if (functionMatch) return functionMatch[1]

  const constMatch = code.match(/const\s+(\w+)\s*=/)
  if (constMatch) return constMatch[1]

  return 'Unknown'
}

/**
 * Clear conversation memory (for testing or user request)
 */
export function clearConversationMemory(chatId: string): void {
  memoryStore.delete(chatId)
}

/**
 * Get memory statistics
 */
export function getMemoryStats(chatId: string): {
  componentsGenerated: number
  feedbackCount: number
  hasPreferences: boolean
} {
  const memory = getConversationMemory(chatId)
  return {
    componentsGenerated: memory.componentHistory.length,
    feedbackCount: memory.userFeedback.length,
    hasPreferences: !!memory.designPreferences,
  }
}
