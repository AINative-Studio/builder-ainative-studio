/**
 * PRD Parser - Extract pages, components, and routes from user requests
 * Used to generate dynamic build steps instead of hardcoded generic ones
 */

export interface ParsedPRD {
  pages: Array<{ name: string; route: string }>
  components: string[]
  features: string[]
  buildSteps: string[]
}

/**
 * Parse user message/PRD to extract actual pages and components being built
 * This generates dynamic, context-aware build steps for better UX
 */
export function parsePRDForBuildSteps(userMessage: string): ParsedPRD {
  const lower = userMessage.toLowerCase()
  const pages: Array<{ name: string; route: string }> = []
  const components: string[] = []
  const features: string[] = []

  // Detect common page patterns
  const pagePatterns = [
    { keywords: ['login', 'signin', 'sign in', 'authentication'], name: 'Login Page', route: '/login' },
    { keywords: ['register', 'signup', 'sign up', 'registration'], name: 'Registration Page', route: '/register' },
    { keywords: ['dashboard', 'admin panel', 'control panel'], name: 'Dashboard', route: '/' },
    { keywords: ['profile', 'user profile', 'account settings'], name: 'Profile Page', route: '/profile' },
    { keywords: ['settings', 'preferences', 'configuration'], name: 'Settings Page', route: '/settings' },
    { keywords: ['home', 'landing', 'homepage', 'landing page'], name: 'Landing Page', route: '/' },
    { keywords: ['about', 'about us', 'company info'], name: 'About Page', route: '/about' },
    { keywords: ['contact', 'contact us', 'get in touch'], name: 'Contact Page', route: '/contact' },
    { keywords: ['product', 'products', 'catalog'], name: 'Products Page', route: '/products' },
    { keywords: ['cart', 'shopping cart', 'basket'], name: 'Shopping Cart', route: '/cart' },
    { keywords: ['checkout', 'payment'], name: 'Checkout Page', route: '/checkout' },
    { keywords: ['blog', 'articles', 'posts'], name: 'Blog Page', route: '/blog' },
    { keywords: ['chat', 'messaging', 'messages'], name: 'Chat Interface', route: '/chat' },
    { keywords: ['analytics', 'reports', 'statistics'], name: 'Analytics Dashboard', route: '/analytics' },
  ]

  // Find matching pages
  pagePatterns.forEach(pattern => {
    if (pattern.keywords.some(keyword => lower.includes(keyword))) {
      pages.push({ name: pattern.name, route: pattern.route })
    }
  })

  // Detect component patterns
  const componentPatterns = [
    { keywords: ['navigation', 'navbar', 'nav bar', 'menu'], name: 'Navigation Component' },
    { keywords: ['sidebar', 'side bar', 'side menu'], name: 'Sidebar Component' },
    { keywords: ['card', 'cards', 'product card'], name: 'Card Component' },
    { keywords: ['table', 'data table', 'grid'], name: 'Table Component' },
    { keywords: ['form', 'forms', 'input form'], name: 'Form Component' },
    { keywords: ['modal', 'dialog', 'popup'], name: 'Modal Component' },
    { keywords: ['chart', 'charts', 'graph', 'graphs'], name: 'Chart Component' },
    { keywords: ['button', 'buttons', 'cta'], name: 'Button Component' },
  ]

  componentPatterns.forEach(pattern => {
    if (pattern.keywords.some(keyword => lower.includes(keyword))) {
      components.push(pattern.name)
    }
  })

  // Detect features
  const featurePatterns = [
    { keywords: ['authentication', 'auth', 'login system'], name: 'User Authentication' },
    { keywords: ['real-time', 'realtime', 'live updates'], name: 'Real-time Updates' },
    { keywords: ['search', 'filter', 'filtering'], name: 'Search & Filtering' },
    { keywords: ['responsive', 'mobile', 'mobile-friendly'], name: 'Responsive Design' },
    { keywords: ['dark mode', 'theme', 'light/dark'], name: 'Theme Toggle' },
    { keywords: ['pagination', 'infinite scroll'], name: 'Pagination' },
  ]

  featurePatterns.forEach(pattern => {
    if (pattern.keywords.some(keyword => lower.includes(keyword))) {
      features.push(pattern.name)
    }
  })

  // Generate dynamic build steps
  const buildSteps: string[] = []

  // Always start with analysis
  buildSteps.push('Analyzing requirements and architecture...')

  // Add page-specific build steps
  pages.forEach(page => {
    buildSteps.push(`Creating ${page.name} (${page.route})`)
  })

  // Add component-specific build steps if no pages detected
  if (pages.length === 0 && components.length > 0) {
    components.forEach(comp => {
      buildSteps.push(`Building ${comp}`)
    })
  }

  // Add feature-specific build steps
  features.forEach(feature => {
    buildSteps.push(`Implementing ${feature}`)
  })

  // If nothing specific detected, fall back to generic steps
  if (buildSteps.length === 1) {
    // Only the analysis step exists, add generic ones
    buildSteps.push('Generating component structure...')
    buildSteps.push('Adding interactivity and styling...')
  }

  // Always end with preview loading
  buildSteps.push('Loading preview environment...')

  return {
    pages,
    components,
    features,
    buildSteps
  }
}

/**
 * Generate concise build step for display (shorter version)
 */
export function formatBuildStep(step: string): string {
  // Shorten long steps for better UI display
  if (step.length > 60) {
    return step.substring(0, 57) + '...'
  }
  return step
}
