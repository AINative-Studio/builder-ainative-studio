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
 * Real bug found live (Meridian, 2026-09-10): all three keyword-detection
 * passes below used a plain substring search (`lower.includes(keyword)`),
 * which matches a trigger word appearing INSIDE an unrelated word. The
 * 'product' keyword (meant to detect an ecommerce product-catalog page)
 * matched "production-quality" — a phrase in company-app/route.ts's own
 * landing-page prompt template, since 'product' is a genuine PREFIX of
 * "production" — so every Company-track landing page request got a false
 * "Products Page (/products)" build step and was fed into
 * analyzeComplexity() as a 2-page app, nudging the model toward building an
 * unrelated product-catalog page instead of the requested single-page
 * landing page (confirmed live via Railway logs: "Pages: 2", "Creating
 * Products Page (/products)" for a plain landing-page request).
 *
 * FULL word-boundary matching (`\bkeyword\b`) fixes this — unlike
 * lib/build/primitive-catalog.ts's `matchesTrigger` (which deliberately uses
 * only a LEADING boundary, because some of its triggers are intentional
 * partial-word stems needing suffix flexibility, e.g. 'aggregat' matching
 * "aggregating"), every keyword list in THIS file already lists its own
 * singular/plural variants as separate explicit array entries (e.g. both
 * 'product' AND 'products' appear below) — so no entry here relies on
 * substring/suffix flexibility, and the stricter full-boundary match is safe.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesKeyword(hay: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(hay)
}

/**
 * Parse explicitly listed pages from structured PRDs
 * Handles formats like:
 * - "1. **Homepage** (/)"
 * - "- Blog Detail (/blog/:slug)"
 * - "2. About Page (/about)"
 */
function parseExplicitPages(text: string): Array<{ name: string; route: string }> {
  const pages: Array<{ name: string; route: string }> = []
  const lines = text.split('\n')

  for (const line of lines) {
    // Match patterns like: "1. **Homepage** (/)" or "- Blog List (/blog)"
    const match = line.match(/(?:^|\s)(?:\d+\.|[-*])\s*\*?\*?([^(]*?)\*?\*?\s*\(([^)]+)\)/i)
    if (match) {
      const name = match[1].trim()
      const route = match[2].trim()

      // Only add if it looks like a page (has a name and starts with /)
      if (name && route.startsWith('/')) {
        pages.push({ name, route })
      }
    }
  }

  return pages
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

  // First, try to parse explicit page lists (like "1. **Homepage** (/)" or "- Homepage (/)")
  const explicitPages = parseExplicitPages(userMessage)
  if (explicitPages.length > 0) {
    pages.push(...explicitPages)
  } else {
    // Fall back to keyword-based detection
    const pagePatterns = [
      { keywords: ['login', 'signin', 'sign in', 'authentication page'], name: 'Login Page', route: '/login' },
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
      { keywords: ['blog list', 'articles', 'posts'], name: 'Blog Page', route: '/blog' },
      { keywords: ['blog detail', 'article detail', 'post detail'], name: 'Blog Detail', route: '/blog/:slug' },
      { keywords: ['categories', 'category'], name: 'Categories Page', route: '/categories' },
      { keywords: ['archive', 'archives'], name: 'Archive Page', route: '/archive' },
      { keywords: ['podcast', 'podcasts', 'audio'], name: 'Podcast Page', route: '/podcast' },
      { keywords: ['subscription', 'subscribe'], name: 'Subscription Page', route: '/subscription' },
      { keywords: ['insights', 'analytics page'], name: 'Insights Page', route: '/insights' },
      { keywords: ['chat', 'messaging', 'messages'], name: 'Chat Interface', route: '/chat' },
      { keywords: ['analytics', 'reports', 'statistics'], name: 'Analytics Dashboard', route: '/analytics' },
    ]

    // Find matching pages
    pagePatterns.forEach(pattern => {
      if (pattern.keywords.some(keyword => matchesKeyword(lower, keyword))) {
        pages.push({ name: pattern.name, route: pattern.route })
      }
    })
  }

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
    if (pattern.keywords.some(keyword => matchesKeyword(lower, keyword))) {
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
    if (pattern.keywords.some(keyword => matchesKeyword(lower, keyword))) {
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
