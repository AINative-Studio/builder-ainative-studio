import { Tool } from '@anthropic-ai/sdk/resources/messages.mjs'
import { stripGradients, hasGradients, findGradients } from '../gradient-blocker'
import {
  stripEmoticons,
  hasEmoticons,
  findEmoticons,
  validateNoEmoticons,
} from '../emoticon-blocker'

/**
 * Component Generation Tool Schema
 * Ensures structured, valid component output
 */
export const COMPONENT_GENERATION_TOOL: Tool = {
  name: 'generate_react_component',
  description: 'Generate a fully functional React component with proper structure and metadata',
  input_schema: {
    type: 'object',
    properties: {
      component_name: {
        type: 'string',
        description: 'Name of the main component (e.g., Dashboard, LandingPage, TodoApp)'
      },
      description: {
        type: 'string',
        description: 'Brief description of what the component does'
      },
      code: {
        type: 'string',
        description: `Complete JSX/JavaScript code for the component. Must be self-contained with all data defined inline.

CRITICAL RULES:
1. COLORS: Use ONLY solid Tailwind colors (bg-blue-500, text-gray-800). NEVER use gradients (bg-gradient-*, from-*, via-*, to-*).
2. ICONS: Use icon libraries (lucide-react, react-icons, heroicons) - NEVER use emoticons/emoji (🏠, 📊, ✅, etc.).
3. Examples of CORRECT icon usage:
   - <Home className="w-4 h-4" /> from lucide-react
   - <FaHome /> from react-icons/fa
   - <HomeIcon className="h-5 w-5" /> from @heroicons/react
4. Emoticons will be automatically stripped if used.`
      },
      features: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of key features implemented (e.g., "Search functionality", "Real-time updates")'
      },
      state_variables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            initial_value: { type: 'string' }
          }
        },
        description: 'State variables used in the component'
      },
      components_used: {
        type: 'array',
        items: { type: 'string' },
        description: 'shadcn/ui components used (e.g., Button, Card, Input)'
      },
      has_unsplash_images: {
        type: 'boolean',
        description: 'Whether the component uses Unsplash images'
      },
      color_scheme: {
        type: 'object',
        properties: {
          primary: { type: 'string' },
          background: { type: 'string' },
          text: { type: 'string' }
        },
        description: 'Color scheme used (must be solid colors, NO gradients)'
      }
    },
    required: ['component_name', 'code', 'description']
  }
}

/**
 * Parse tool use response
 */
export interface ComponentGenerationResult {
  component_name: string
  description: string
  code: string
  features?: string[]
  state_variables?: Array<{
    name: string
    type: string
    initial_value: string
  }>
  components_used?: string[]
  has_unsplash_images?: boolean
  color_scheme?: {
    primary: string
    background: string
    text: string
  }
}

/**
 * Extract code from structured tool response
 * Automatically removes Tailwind gradients and emoticons
 */
export function extractComponentCode(toolUseInput: any): string {
  const result = toolUseInput as ComponentGenerationResult

  // Check for gradients BEFORE stripping
  if (hasGradients(result.code)) {
    const gradientsFound = findGradients(result.code)
    console.warn(
      '⚠️ Claude generated code with Tailwind gradients - auto-removing:',
      gradientsFound
    )
  }

  // Check for emoticons BEFORE stripping
  if (hasEmoticons(result.code)) {
    const emoticonsValidation = validateNoEmoticons(result.code)
    console.warn(
      '⚠️ Claude generated code with emoticons - auto-removing:',
      emoticonsValidation.emoticons
    )
    console.log('💡 Suggested alternatives:')
    emoticonsValidation.suggestions.forEach(({ emoticon, alternative }) => {
      console.log(`   ${emoticon} → ${alternative}`)
    })
  }

  // AUTOMATICALLY STRIP ALL GRADIENTS AND EMOTICONS
  let cleanCode = stripGradients(result.code)
  cleanCode = stripEmoticons(cleanCode)

  // Return clean code without gradients or emoticons
  return cleanCode
}

/**
 * Validate component generation output
 */
export function validateComponentGeneration(result: ComponentGenerationResult): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Check for required fields
  if (!result.component_name) errors.push('Missing component_name')
  if (!result.code) errors.push('Missing code')
  if (!result.description) errors.push('Missing description')

  // Check for gradients (forbidden)
  if (result.code.includes('bg-gradient') ||
      result.code.includes('from-') ||
      result.code.includes('to-')) {
    errors.push('Code contains forbidden gradients')
  }

  // Check for emoticons (forbidden)
  const emoticonCheck = validateNoEmoticons(result.code)
  if (!emoticonCheck.valid) {
    errors.push(
      `Code contains forbidden emoticons: ${emoticonCheck.emoticons.join(', ')}. Use icon libraries instead.`
    )
  }

  // Check for undefined variables
  const variableRegex = /(\w+)\.map\(/g
  const mapUsages = [...result.code.matchAll(variableRegex)]
  for (const match of mapUsages) {
    const varName = match[1]
    if (!result.code.includes(`const ${varName} = `)) {
      errors.push(`Variable '${varName}' used in .map() but not defined`)
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
