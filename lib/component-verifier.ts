// Component verification and replacement system for LLAMA UI

// Available Shadcn components in our preview environment (18 components total)
const AVAILABLE_COMPONENTS = [
  // Basic UI Components (Sprint 1-2)
  'Button',
  'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
  'Input',
  'Label',
  'Badge',
  'Avatar', 'AvatarImage', 'AvatarFallback',
  'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell',
  'Separator',
  // Advanced Components (Sprint 5-6)
  'Dialog', 'DialogOverlay', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter',
  'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem',
  'Tabs', 'TabsList', 'TabsTrigger', 'TabsContent',
  'Progress', 'CircularProgress',
  'Checkbox',
  'RadioGroup', 'RadioGroupItem',
  'Toast', 'ToastTitle', 'ToastDescription',
  'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
  'Alert', 'AlertTitle', 'AlertDescription',
  'Popover', 'PopoverTrigger', 'PopoverContent'
]

// Common component replacements mapping
const COMPONENT_REPLACEMENTS: Record<string, string> = {
  // Chart components -> basic UI
  'LineChart': 'Card with div elements for chart visualization',
  'BarChart': 'Card with div elements for bar visualization',
  'PieChart': 'Card with div elements for pie visualization',
  'Chart': 'Card with div elements for data visualization',
  'ResponsiveContainer': 'div container',
  'XAxis': 'div with labels',
  'YAxis': 'div with labels',
  'CartesianGrid': 'div with grid styling',
  'Tooltip': 'div with hover effects',
  'Legend': 'div with legend styling',

  // Form components
  'Form': 'div with form styling',
  'FormItem': 'div with form item styling',
  'FormLabel': 'Label',
  'FormControl': 'div',
  'FormMessage': 'div with error styling',
  'Select': 'div with dropdown styling',
  'SelectContent': 'div',
  'SelectItem': 'div',
  'SelectTrigger': 'Button',
  'SelectValue': 'span',

  // Navigation
  'Navigation': 'nav element',
  'NavigationMenu': 'nav element',
  'NavigationMenuItem': 'div',
  'NavigationMenuTrigger': 'Button',
  'NavigationMenuContent': 'div',
  'Sidebar': 'div with sidebar styling',
  'Header': 'header element',
  'Footer': 'footer element',

  // Advanced components (now available - no need to replace)
  'AlertDialog': 'Dialog component',
  'Sheet': 'Dialog component with slide animation',

  // Data display
  'DataTable': 'Table',
  'ScrollArea': 'div with overflow styling',
  'Command': 'div with command styling',
  'HoverCard': 'div with hover card styling',

  // Layout
  'Container': 'div with container styling',
  'Grid': 'div with grid styling',
  'Flex': 'div with flex styling',
  'Box': 'div',
  'Stack': 'div with stack styling'
}

// Extract component names from user message
export function extractComponentNames(message: string): string[] {
  const componentPatterns = [
    // Direct mentions
    /\b([A-Z][a-zA-Z]*(?:Chart|Table|Card|Button|Input|Form|Dialog|Menu|Navigation|Select|Progress|Accordion|Tab|Sheet|Alert|Command|Popover|Sidebar|Header|Footer))\b/g,
    // Generic component mentions
    /\b([A-Z][a-zA-Z]*Component)\b/g,
    // React component patterns
    /<([A-Z][a-zA-Z]*)/g
  ]

  const foundComponents = new Set<string>()

  componentPatterns.forEach(pattern => {
    const matches = message.matchAll(pattern)
    for (const match of matches) {
      foundComponents.add(match[1])
    }
  })

  return Array.from(foundComponents)
}

// Verify if components exist in our available set
export function verifyComponents(components: string[]): {
  valid: string[]
  invalid: string[]
  replacements: Record<string, string>
} {
  const valid: string[] = []
  const invalid: string[] = []
  const replacements: Record<string, string> = {}

  components.forEach(component => {
    if (AVAILABLE_COMPONENTS.includes(component)) {
      valid.push(component)
    } else {
      invalid.push(component)
      if (COMPONENT_REPLACEMENTS[component]) {
        replacements[component] = COMPONENT_REPLACEMENTS[component]
      } else {
        // Generic replacement strategy
        if (component.includes('Chart')) {
          replacements[component] = 'Card with div elements for chart visualization'
        } else if (component.includes('Form')) {
          replacements[component] = 'div with form styling'
        } else if (component.includes('Dialog') || component.includes('Modal')) {
          replacements[component] = 'div with modal styling'
        } else if (component.includes('Menu') || component.includes('Navigation')) {
          replacements[component] = 'nav element with menu styling'
        } else {
          replacements[component] = 'div with appropriate styling'
        }
      }
    }
  })

  return { valid, invalid, replacements }
}

// Generate enhanced prompt with component verification
export function enhancePromptWithVerification(
  originalMessage: string,
  verification: ReturnType<typeof verifyComponents>
): string {
  let enhancedPrompt = originalMessage

  // Add available components context
  enhancedPrompt += `\n\nIMPORTANT COMPONENT CONSTRAINTS:
Available Shadcn components: ${AVAILABLE_COMPONENTS.join(', ')}

`

  // Add replacement instructions if there are invalid components
  if (verification.invalid.length > 0) {
    enhancedPrompt += `COMPONENT REPLACEMENTS REQUIRED:
`
    Object.entries(verification.replacements).forEach(([invalid, replacement]) => {
      enhancedPrompt += `- Replace "${invalid}" with: ${replacement}\n`
    })
    enhancedPrompt += `\n`
  }

  enhancedPrompt += `GENERATION RULES:
1. ONLY use components from the available list above
2. Create self-contained components with no external imports
3. Use built-in React hooks (useState, useEffect, etc.)
4. Use Tailwind CSS classes for styling
5. Create impressive visual effects with CSS animations and gradients
6. If you need charts or complex components, create them using div elements and CSS
7. Make the component functional and interactive

Generate a single React component that works in the browser with no external dependencies.`

  return enhancedPrompt
}

// Main verification function to be used in the API route
export function verifyAndEnhancePrompt(message: string): {
  enhancedPrompt: string
  verification: ReturnType<typeof verifyComponents>
  extractedComponents: string[]
} {
  const extractedComponents = extractComponentNames(message)
  const verification = verifyComponents(extractedComponents)
  const enhancedPrompt = enhancePromptWithVerification(message, verification)

  return {
    enhancedPrompt,
    verification,
    extractedComponents
  }
}