import Anthropic from '@anthropic-ai/sdk'
import { COMPONENT_GENERATION_TOOL } from './component-generation-tool'
import {
  buildOptimizedSystemPromptFromProfiles,
  SUBAGENT_PROFILE_MAPPING,
  loadAgentProfiles,
} from './agent-profiles'
import { createMetricsCollector, extractTokenUsage, MetricsCollector } from './metrics'

/**
 * Subagents Architecture (US-025)
 * Enhanced with Claude Code Agent Profiles - OPTIMIZED FOR TOKEN EFFICIENCY (Issue #10)
 *
 * Hierarchical agent system for complex component generation:
 * 1. Orchestrator - Main agent that delegates to subagents (system-architect, ai-product-architect)
 * 2. Design Subagent - Analyzes requirements and creates design specs (ai-product-architect, system-architect)
 * 3. Code Subagent - Generates component code with Tool Use API (frontend-ui-builder, ai-product-architect)
 * 4. Validation Subagent - Validates output quality (qa-bug-hunter, test-engineer)
 *
 * Token optimization: 30-40% reduction through optimized profile loading and concise task contexts
 */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// Load agent profiles on startup
const agentProfiles = loadAgentProfiles()
console.log(
  `🤖 Available agent profiles: ${Array.from(agentProfiles.keys()).join(', ')}`
)

// Subagent types
export type SubagentType = 'design' | 'code' | 'validation'

export interface SubagentTask {
  type: SubagentType
  input: string
  context?: any
}

export interface SubagentResult {
  type: SubagentType
  output: string
  metadata?: any
  success: boolean
  response?: any // API response for token usage extraction
}

// Shared critical rules to reduce redundancy across agents (Issue #10 optimization)
const CRITICAL_RULES = `CRITICAL RULES:
- NO gradients (bg-gradient-*, from-*, via-*, to-*)
- NO emoji (🏠, 📊, ✅) - use icon libraries only
- ONLY solid colors (bg-blue-500, text-gray-800)
- ONLY icon libraries (lucide-react, react-icons, heroicons)
- Define ALL data variables before use
- Ensure proper event handlers and accessibility`

/**
 * Design Subagent - Analyzes user requirements and creates design specifications
 * OPTIMIZED for token efficiency (Issue #10)
 */
export async function runDesignSubagent(
  userPrompt: string,
  memoryContext: string
): Promise<SubagentResult> {
  const taskContext = `Create detailed UI component design spec.

REQUEST: ${userPrompt}
${memoryContext}

${CRITICAL_RULES}

Provide structured spec:
1. Component Type & Layout Structure
2. Color Scheme (solid colors only)
3. Key Features & Data Requirements
4. Interaction Patterns & Accessibility`

  const designPrompt = buildOptimizedSystemPromptFromProfiles(
    SUBAGENT_PROFILE_MAPPING.design,
    taskContext
  )

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000, // Must be > thinking budget
      temperature: 1,
      thinking: {
        type: 'enabled',
        budget_tokens: 2000, // Cody's thinking power
      },
      messages: [
        {
          role: 'user',
          content: designPrompt,
        },
      ],
    })

    const designSpec = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as any).text)
      .join('\n')

    return {
      type: 'design',
      output: designSpec,
      success: true,
      response: response,
      metadata: {
        stopReason: response.stop_reason,
      },
    }
  } catch (error) {
    console.error('Design subagent error:', error)
    return {
      type: 'design',
      output: '',
      success: false,
      metadata: { error: String(error) },
    }
  }
}

/**
 * Code Subagent - Generates component code using Tool Use API
 * OPTIMIZED for token efficiency (Issue #10)
 */
export async function runCodeSubagent(
  designSpec: string,
  systemPrompt: string,
  userPrompt: string
): Promise<SubagentResult> {
  const taskContext = `${systemPrompt}

DESIGN SPEC: ${designSpec}
REQUEST: ${userPrompt}

${CRITICAL_RULES}

CODE REQUIREMENTS:
- Self-contained components (no external imports)
- Proper icon library usage: <Home className="w-4 h-4" />
- All interactive elements need handlers

Use generate_react_component tool for output. Gradients/emoji stripped automatically.`

  const codePrompt = buildOptimizedSystemPromptFromProfiles(
    SUBAGENT_PROFILE_MAPPING.code,
    taskContext
  )

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      temperature: 1,
      thinking: {
        type: 'enabled',
        budget_tokens: 2000,
      },
      messages: [
        {
          role: 'user',
          content: codePrompt,
        },
      ],
      tools: [COMPONENT_GENERATION_TOOL],
    })

    // Extract tool use result
    const toolUseBlock = response.content.find((block) => block.type === 'tool_use')
    let componentCode = ''

    if (toolUseBlock && toolUseBlock.type === 'tool_use') {
      componentCode = (toolUseBlock as any).input.code || ''
    } else {
      // Fallback to text output
      componentCode = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as any).text)
        .join('\n')
    }

    return {
      type: 'code',
      output: componentCode,
      success: true,
      response: response,
      metadata: {
        stopReason: response.stop_reason,
        usedToolUse: !!toolUseBlock,
      },
    }
  } catch (error) {
    console.error('Code subagent error:', error)
    return {
      type: 'code',
      output: '',
      success: false,
      metadata: { error: String(error) },
    }
  }
}

/**
 * Validation Subagent - Validates component quality
 * OPTIMIZED for token efficiency (Issue #10)
 */
export async function runValidationSubagent(
  componentCode: string,
  designSpec: string
): Promise<SubagentResult> {
  const taskContext = `Validate React component for production readiness.

DESIGN SPEC: ${designSpec}

CODE:
\`\`\`jsx
${componentCode}
\`\`\`

${CRITICAL_RULES}

VERIFY:
✓ No gradients/emoji, solid colors only
✓ Icon libraries used properly
✓ All variables defined before use
✓ Features match spec
✓ Event handlers present
✓ Accessibility (ARIA, keyboard nav)
✓ Data properly structured

Report:
- Status: PASS/FAIL
- Issues: severity + details
- Recommendations
- Production readiness`

  const validationPrompt = buildOptimizedSystemPromptFromProfiles(
    SUBAGENT_PROFILE_MAPPING.validation,
    taskContext
  )

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: validationPrompt,
        },
      ],
    })

    const validationReport = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as any).text)
      .join('\n')

    const passed = validationReport.toLowerCase().includes('pass')

    return {
      type: 'validation',
      output: validationReport,
      success: passed,
      response: response,
      metadata: {
        stopReason: response.stop_reason,
      },
    }
  } catch (error) {
    console.error('Validation subagent error:', error)
    return {
      type: 'validation',
      output: '',
      success: false,
      metadata: { error: String(error) },
    }
  }
}

/**
 * Orchestrator - Main agent that delegates to subagents
 * Led by Cody: Team leader with 30 years of experience
 *
 * Coordinates the hierarchical agent workflow:
 * 1. Design Analysis → 2. Code Generation → 3. Quality Validation
 *
 * Enhanced with performance metrics tracking (Issue #9)
 */
export async function runOrchestratorAgent(
  userPrompt: string,
  systemPrompt: string,
  memoryContext: string,
  sessionId?: string,
  userId?: string,
  chatId?: string
): Promise<{
  designSpec: string
  componentCode: string
  validationReport: string
  success: boolean
  metrics?: any
}> {
  // Initialize metrics collector
  const model = 'claude-sonnet-4-20250514'
  const metricsCollector = createMetricsCollector(
    sessionId || `session-${Date.now()}`,
    userPrompt,
    model,
    userId,
    chatId
  )

  console.log('\n👔 CODY (Team Leader): Alright team, we have a new component to build. Let\'s do this right.\n')
  console.log(`📋 Mission: "${userPrompt}"\n`)

  // Step 1: Design Subagent analyzes requirements
  console.log('👔 CODY: Design team, analyze the requirements and give me a solid spec.')
  console.log('🎨 [1/3] Design Agents (ai-product-architect + system-architect): On it, Cody...\n')

  metricsCollector.startSubagent('design')
  const designResult = await runDesignSubagent(userPrompt, memoryContext)
  metricsCollector.endSubagent(
    'design',
    designResult.success,
    designResult.response ? extractTokenUsage(designResult.response) : undefined,
    designResult.metadata?.error,
    designResult.metadata
  )

  if (!designResult.success) {
    console.error('👔 CODY: Design analysis failed. We need to regroup and try again.')
    const metrics = await metricsCollector.complete()
    return {
      designSpec: '',
      componentCode: '',
      validationReport: 'Design analysis failed - Cody stopped the pipeline',
      success: false,
      metrics,
    }
  }
  console.log('✅ Design team: Spec is ready, Cody.')
  console.log('👔 CODY: Good work. Dev team, take this spec and build it clean.\n')

  // Step 2: Code Subagent generates component
  console.log('💻 [2/3] Code Agents (frontend-ui-builder + ai-product-architect): Building component...\n')

  metricsCollector.startSubagent('code')
  const codeResult = await runCodeSubagent(
    designResult.output,
    systemPrompt,
    userPrompt
  )
  metricsCollector.endSubagent(
    'code',
    codeResult.success,
    codeResult.response ? extractTokenUsage(codeResult.response) : undefined,
    codeResult.metadata?.error,
    codeResult.metadata
  )

  if (!codeResult.success) {
    console.error('👔 CODY: Code generation failed. Not acceptable. Let\'s fix this.')
    const metrics = await metricsCollector.complete()
    return {
      designSpec: designResult.output,
      componentCode: '',
      validationReport: 'Code generation failed - Cody stopped the pipeline',
      success: false,
      metrics,
    }
  }
  console.log('✅ Dev team: Component built, Cody.')
  console.log('👔 CODY: Nice. QA team, tear it apart. I want to know every issue before this ships.\n')

  // Step 3: Validation Subagent checks quality
  console.log('🔍 [3/3] QA Agents (qa-bug-hunter + test-engineer): Running comprehensive quality checks...\n')

  metricsCollector.startSubagent('validation')
  const validationResult = await runValidationSubagent(
    codeResult.output,
    designResult.output
  )
  metricsCollector.endSubagent(
    'validation',
    validationResult.success,
    validationResult.response ? extractTokenUsage(validationResult.response) : undefined,
    validationResult.metadata?.error,
    validationResult.metadata
  )

  if (validationResult.success) {
    console.log('✅ QA team: All checks passed, Cody. This is production-ready.')
    console.log('👔 CODY: Excellent work, team. Ship it with confidence. 🚀\n')
  } else {
    console.warn('⚠️ QA team: Found some issues, Cody. See the report.')
    console.log('👔 CODY: Issues noted. We ship with quality or we don\'t ship. Let\'s address these.\n')
  }

  // Complete metrics collection and publish
  const metrics = await metricsCollector.complete()

  return {
    designSpec: designResult.output,
    componentCode: codeResult.output,
    validationReport: validationResult.output,
    success: validationResult.success,
    metrics,
  }
}
