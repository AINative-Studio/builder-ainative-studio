import Anthropic from '@anthropic-ai/sdk'
import { COMPONENT_GENERATION_TOOL } from './component-generation-tool'
import {
  buildSystemPromptFromProfiles,
  SUBAGENT_PROFILE_MAPPING,
  loadAgentProfiles,
} from './agent-profiles'

/**
 * Subagents Architecture (US-025)
 * Enhanced with Claude Code Agent Profiles
 *
 * Hierarchical agent system for complex component generation:
 * 1. Orchestrator - Main agent that delegates to subagents (system-architect, ai-product-architect)
 * 2. Design Subagent - Analyzes requirements and creates design specs (ai-product-architect, system-architect)
 * 3. Code Subagent - Generates component code with Tool Use API (frontend-ui-builder, ai-product-architect)
 * 4. Validation Subagent - Validates output quality (qa-bug-hunter, test-engineer)
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
}

/**
 * Design Subagent - Analyzes user requirements and creates design specifications
 * Enhanced with Claude Code Agent Profiles
 */
export async function runDesignSubagent(
  userPrompt: string,
  memoryContext: string
): Promise<SubagentResult> {
  // Build system prompt from agent profiles
  const taskContext = `Analyze the user's request and create a detailed design specification for a UI component.

USER REQUEST:
${userPrompt}

${memoryContext}

**CRITICAL DESIGN RULES:**
- ❌ ABSOLUTELY NO GRADIENTS (no bg-gradient-*, from-*, to-* classes)
- ❌ ABSOLUTELY NO EMOTICONS (no emoji like 🏠, 📊, ✅, etc.)
- ✅ Use SOLID COLORS ONLY (bg-blue-500, bg-gray-100, etc.)
- ✅ Use ICON LIBRARIES ONLY (lucide-react, react-icons, heroicons)
- ✅ Ensure all data variables are explicitly defined
- ✅ Plan for responsive design (mobile-first)
- ✅ Include accessibility considerations

Provide a comprehensive, structured design specification including:
1. Component Type (Dashboard, Landing Page, Form, etc.)
2. Layout Structure (Grid, Flexbox, sections)
3. Color Scheme (SOLID COLORS ONLY)
4. Key Features to implement
5. Data Requirements (what mock data is needed)
6. Interaction Patterns (search, filters, forms, etc.)
7. Accessibility requirements`

  const designPrompt = buildSystemPromptFromProfiles(
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
 * Enhanced with Claude Code Agent Profiles
 */
export async function runCodeSubagent(
  designSpec: string,
  systemPrompt: string,
  userPrompt: string
): Promise<SubagentResult> {
  // Build system prompt from agent profiles
  const taskContext = `${systemPrompt}

DESIGN SPECIFICATION:
${designSpec}

USER REQUEST:
${userPrompt}

**CRITICAL CODE GENERATION RULES:**
1. ❌ NEVER use Tailwind gradient classes:
   - NO bg-gradient-to-r, bg-gradient-to-br, etc.
   - NO from-blue-500, from-purple-600, etc.
   - NO via-pink-500, etc.
   - NO to-red-500, to-yellow-400, etc.
2. ❌ NEVER use emoticons/emoji in code:
   - NO 🏠, 📊, ✅, ❌, 🔍, etc.
   - Use icon libraries instead: <Home />, <BarChart />, <Check />, <X />, <Search />
3. ✅ ONLY use solid Tailwind colors: bg-blue-500, text-gray-800, border-gray-300
4. ✅ ONLY use icon libraries for icons: lucide-react, react-icons, heroicons
   Examples:
   - lucide-react: <Home className="w-4 h-4" />
   - react-icons: <FaHome />
   - heroicons: <HomeIcon className="h-5 w-5" />
5. ✅ Define ALL data variables before using them in .map() or other iterations
6. ✅ Make components fully self-contained (no imports needed)
7. ✅ Ensure all interactive elements have proper event handlers

Use the generate_react_component tool to provide structured output. Any gradients or emoticons will be automatically stripped.`

  const codePrompt = buildSystemPromptFromProfiles(
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
 * Enhanced with Claude Code Agent Profiles
 */
export async function runValidationSubagent(
  componentCode: string,
  designSpec: string
): Promise<SubagentResult> {
  // Build system prompt from agent profiles
  const taskContext = `Validate this React component against the design specification for production readiness.

DESIGN SPECIFICATION:
${designSpec}

GENERATED CODE:
\`\`\`jsx
${componentCode}
\`\`\`

**Quality Checks Required:**
1. ❌ Gradients - Check for any Tailwind gradient classes (bg-gradient-*, from-*, via-*, to-*)
2. ❌ Emoticons - Check for any emoji/emoticons (🏠, 📊, ✅, etc.) - must use icon libraries instead
3. ❌ Undefined Variables - Ensure all variables used in .map(), .filter(), etc. are defined
4. ❌ Missing Features - Verify all features from design spec are implemented
5. ❌ Color Scheme - Confirm only solid colors are used (no gradients)
6. ✅ Icon Libraries - Verify proper icon library usage (lucide-react, react-icons, heroicons)
7. ✅ Event Handlers - All interactive elements have proper onClick, onChange, etc.
8. ✅ Component Structure - Proper React component structure and naming
9. ✅ Accessibility - ARIA labels, keyboard navigation where needed
10. ✅ Data Structure - Mock data is properly structured and typed

Provide a comprehensive validation report:
- **Status**: PASS or FAIL
- **Issues Found**: Detailed list with severity (Critical, High, Medium, Low)
- **Recommendations**: Specific fixes needed
- **Production Readiness**: Overall assessment`

  const validationPrompt = buildSystemPromptFromProfiles(
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
 */
export async function runOrchestratorAgent(
  userPrompt: string,
  systemPrompt: string,
  memoryContext: string
): Promise<{
  designSpec: string
  componentCode: string
  validationReport: string
  success: boolean
}> {
  console.log('\n👔 CODY (Team Leader): Alright team, we have a new component to build. Let\'s do this right.\n')
  console.log(`📋 Mission: "${userPrompt}"\n`)

  // Step 1: Design Subagent analyzes requirements
  console.log('👔 CODY: Design team, analyze the requirements and give me a solid spec.')
  console.log('🎨 [1/3] Design Agents (ai-product-architect + system-architect): On it, Cody...\n')
  const designResult = await runDesignSubagent(userPrompt, memoryContext)

  if (!designResult.success) {
    console.error('👔 CODY: Design analysis failed. We need to regroup and try again.')
    return {
      designSpec: '',
      componentCode: '',
      validationReport: 'Design analysis failed - Cody stopped the pipeline',
      success: false,
    }
  }
  console.log('✅ Design team: Spec is ready, Cody.')
  console.log('👔 CODY: Good work. Dev team, take this spec and build it clean.\n')

  // Step 2: Code Subagent generates component
  console.log('💻 [2/3] Code Agents (frontend-ui-builder + ai-product-architect): Building component...\n')
  const codeResult = await runCodeSubagent(
    designResult.output,
    systemPrompt,
    userPrompt
  )

  if (!codeResult.success) {
    console.error('👔 CODY: Code generation failed. Not acceptable. Let\'s fix this.')
    return {
      designSpec: designResult.output,
      componentCode: '',
      validationReport: 'Code generation failed - Cody stopped the pipeline',
      success: false,
    }
  }
  console.log('✅ Dev team: Component built, Cody.')
  console.log('👔 CODY: Nice. QA team, tear it apart. I want to know every issue before this ships.\n')

  // Step 3: Validation Subagent checks quality
  console.log('🔍 [3/3] QA Agents (qa-bug-hunter + test-engineer): Running comprehensive quality checks...\n')
  const validationResult = await runValidationSubagent(
    codeResult.output,
    designResult.output
  )

  if (validationResult.success) {
    console.log('✅ QA team: All checks passed, Cody. This is production-ready.')
    console.log('👔 CODY: Excellent work, team. Ship it with confidence. 🚀\n')
  } else {
    console.warn('⚠️ QA team: Found some issues, Cody. See the report.')
    console.log('👔 CODY: Issues noted. We ship with quality or we don\'t ship. Let\'s address these.\n')
  }

  return {
    designSpec: designResult.output,
    componentCode: codeResult.output,
    validationReport: validationResult.output,
    success: validationResult.success,
  }
}
