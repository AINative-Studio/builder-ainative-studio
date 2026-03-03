/**
 * Intent Detector Service (US-032)
 *
 * Detects UI type from user prompts using keyword analysis
 * and injects type-specific instructions into the prompt.
 */

export type UIType = 'dashboard' | 'form' | 'landing' | 'ecommerce' | 'blog' | 'admin' | 'unknown'

export interface IntentDetectionResult {
  type: UIType
  confidence: number
  keywords: string[]
  typeSpecificInstructions: string
}

// Keyword patterns for each UI type
const UI_TYPE_KEYWORDS: Record<UIType, string[]> = {
  dashboard: [
    'dashboard',
    'analytics',
    'metrics',
    'admin panel',
    'statistics',
    'charts',
    'graphs',
    'kpi',
    'data visualization',
    'overview'
  ],
  form: [
    'form',
    'input',
    'submit',
    'registration',
    'contact',
    'signup',
    'login',
    'validation',
    'field',
    'checkbox'
  ],
  landing: [
    'landing page',
    'hero',
    'cta',
    'marketing',
    'features',
    'pricing',
    'testimonials',
    'call to action',
    'value proposition'
  ],
  ecommerce: [
    'product',
    'cart',
    'checkout',
    'shop',
    'store',
    'catalog',
    'purchase',
    'add to cart',
    'price',
    'inventory'
  ],
  blog: [
    'blog',
    'article',
    'post',
    'content',
    'author',
    'reading',
    'publication',
    'news',
    'feed'
  ],
  admin: [
    'admin',
    'settings',
    'configuration',
    'management',
    'permissions',
    'users',
    'roles',
    'system'
  ],
  unknown: []
}

// Type-specific instructions to enhance prompts
const TYPE_SPECIFIC_INSTRUCTIONS: Record<UIType, string> = {
  dashboard: `
DASHBOARD REQUIREMENTS:
- Include 4+ metric cards in a responsive grid layout
- Use charts or data visualizations where appropriate
- Display key performance indicators (KPIs) prominently
- Add filters or date range selectors for interactivity
- Include real-time or periodic data updates
- Use Card components for metric groupings
- Add trend indicators (up/down arrows, percentages)
`,
  form: `
FORM REQUIREMENTS:
- Include proper Label/Input pairing for all fields
- Implement field validation with error messages
- Add form state management with useState
- Include loading states during submission
- Show success/error feedback after submission
- Use appropriate input types (email, password, number, etc.)
- Ensure accessibility with ARIA labels and keyboard navigation
`,
  landing: `
LANDING PAGE REQUIREMENTS:
- Include a hero section with headline and subheadline
- Add clear call-to-action (CTA) buttons
- Include features/benefits section with icons
- Add social proof (testimonials, logos, stats)
- Use gradient backgrounds for visual appeal
- Create email capture or signup form
- Include footer with links
`,
  ecommerce: `
ECOMMERCE REQUIREMENTS:
- Display products in a grid layout
- Include product images, names, and prices
- Add "Add to Cart" buttons for each product
- Implement cart state management
- Show cart item count and total
- Add product filtering/sorting options
- Include product categories or tags
`,
  blog: `
BLOG REQUIREMENTS:
- List articles/posts with titles and metadata
- Include author information and publish dates
- Add category/tag filtering
- Show post excerpts or descriptions
- Implement search functionality
- Add read more links or cards
- Include pagination or infinite scroll
`,
  admin: `
ADMIN PANEL REQUIREMENTS:
- Include navigation sidebar or header
- Add settings/configuration sections
- Implement toggle switches for boolean settings
- Include user management or permissions
- Add data tables for entity management
- Include save/cancel actions
- Show confirmation for destructive actions
`,
  unknown: ''
}

/**
 * Detect UI type from user prompt
 *
 * @param prompt User's prompt text
 * @returns Detection result with type, confidence, and instructions
 */
export function detectUIType(prompt: string): IntentDetectionResult {
  const lowerPrompt = prompt.toLowerCase()
  const detectionScores: Record<UIType, { score: number; keywords: string[] }> = {
    dashboard: { score: 0, keywords: [] },
    form: { score: 0, keywords: [] },
    landing: { score: 0, keywords: [] },
    ecommerce: { score: 0, keywords: [] },
    blog: { score: 0, keywords: [] },
    admin: { score: 0, keywords: [] },
    unknown: { score: 0, keywords: [] }
  }

  // Score each UI type based on keyword matches
  for (const [type, keywords] of Object.entries(UI_TYPE_KEYWORDS)) {
    if (type === 'unknown') continue

    for (const keyword of keywords) {
      if (lowerPrompt.includes(keyword)) {
        detectionScores[type as UIType].score += 1
        detectionScores[type as UIType].keywords.push(keyword)
      }
    }
  }

  // Find type with highest score
  let maxScore = 0
  let detectedType: UIType = 'unknown'
  let matchedKeywords: string[] = []

  for (const [type, data] of Object.entries(detectionScores)) {
    if (data.score > maxScore) {
      maxScore = data.score
      detectedType = type as UIType
      matchedKeywords = data.keywords
    }
  }

  // Calculate confidence (0-1)
  // Confidence is based on number of keyword matches
  // 1 match = 30%, 2 matches = 60%, 3+ matches = 90%+
  let confidence = 0
  if (maxScore >= 3) {
    confidence = 0.9
  } else if (maxScore === 2) {
    confidence = 0.7
  } else if (maxScore === 1) {
    confidence = 0.5
  }

  return {
    type: detectedType,
    confidence,
    keywords: matchedKeywords,
    typeSpecificInstructions: TYPE_SPECIFIC_INSTRUCTIONS[detectedType]
  }
}

/**
 * Enhance prompt with type-specific instructions
 *
 * @param prompt Original user prompt
 * @param detection Intent detection result
 * @returns Enhanced prompt with instructions
 */
export function enhancePromptWithIntent(
  prompt: string,
  detection?: IntentDetectionResult
): string {
  const result = detection || detectUIType(prompt)

  // Only add instructions if confidence is sufficient
  if (result.confidence < 0.5 || result.type === 'unknown') {
    return prompt
  }

  return `${prompt}\n\n${result.typeSpecificInstructions}`
}

/**
 * Get type-specific examples for a detected UI type
 *
 * @param type UI type
 * @returns Category name for fetching examples
 */
export function getExampleCategory(type: UIType): string {
  return type === 'unknown' ? 'dashboard' : type
}
