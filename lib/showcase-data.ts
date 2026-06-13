/**
 * Showcase Gallery Data
 *
 * Seed entries for the showcase gallery. Free-tier generations
 * are also auto-added via the API.
 */

export interface ShowcaseEntry {
  slug: string
  title: string
  description: string
  category: string
  prompt: string
  chatId?: string
  generatedCode?: string
  thumbnail?: string
  tags: string[]
  featured: boolean
  createdAt: string
}

// SEO-optimized categories for organic search
export const SHOWCASE_CATEGORIES = [
  { id: 'dashboard', label: 'Dashboards', description: 'Analytics dashboards, admin panels, and data visualization' },
  { id: 'landing', label: 'Landing Pages', description: 'SaaS landing pages, marketing sites, and product pages' },
  { id: 'ecommerce', label: 'E-Commerce', description: 'Product pages, shopping carts, and checkout flows' },
  { id: 'saas', label: 'SaaS Apps', description: 'Project management, CRM, and productivity tools' },
  { id: 'social', label: 'Social & Chat', description: 'Chat interfaces, social feeds, and messaging apps' },
  { id: 'productivity', label: 'Productivity', description: 'Task boards, calendars, file managers, and settings' },
  { id: 'creative', label: 'Creative', description: 'Music players, recipe apps, weather apps, and portfolios' },
] as const

// Seed showcase entries — these are always available
export const SEED_SHOWCASE: ShowcaseEntry[] = [
  {
    slug: 'analytics-dashboard',
    title: 'Analytics Dashboard',
    description: 'A professional analytics dashboard with 4 metric cards showing key KPIs, a bar chart for monthly trends, and a recent transactions table. Built with React, Tailwind CSS, Recharts, and Lucide icons.',
    category: 'dashboard',
    prompt: 'Build a dashboard with 4 metric cards for Users (2,543), Revenue ($45,678), Sessions (342), Growth Rate (12.5%). Add a bar chart showing monthly data and a recent transactions table with 5 rows.',
    tags: ['dashboard', 'analytics', 'metrics', 'charts', 'react', 'tailwind'],
    featured: true,
    createdAt: '2026-06-10',
  },
  {
    slug: 'saas-pricing-page',
    title: 'SaaS Pricing Page',
    description: 'A modern SaaS pricing page with 3 plan tiers (Free, Pro, Enterprise), feature comparison lists, highlighted recommended plan, and call-to-action buttons. Responsive design with Tailwind CSS.',
    category: 'landing',
    prompt: 'Build a pricing page with 3 tiers: Free ($0), Pro ($29/mo), Enterprise ($99/mo). Include feature lists for each tier, a highlighted "Most Popular" badge on Pro, and CTA buttons.',
    tags: ['pricing', 'saas', 'landing-page', 'subscription', 'react'],
    featured: true,
    createdAt: '2026-06-10',
  },
  {
    slug: 'team-directory',
    title: 'Team Directory',
    description: 'A team directory page with search functionality and a responsive grid of team member cards featuring avatars, roles, departments, and contact buttons.',
    category: 'saas',
    prompt: 'Build a team page with search bar and a grid of 6 team member cards with avatars, names, roles, departments, and contact buttons.',
    chatId: 'zmDDjcYth4hsCt6byRWZq',
    tags: ['team', 'directory', 'cards', 'search', 'grid'],
    featured: false,
    createdAt: '2026-06-10',
  },
  {
    slug: 'ai-chat-interface',
    title: 'AI Chat Interface',
    description: 'A polished AI chat interface with a conversation sidebar, message area with user/assistant message bubbles, typing indicator, and message input with send button.',
    category: 'social',
    prompt: 'Build an AI chat interface with: sidebar showing 5 conversation titles, main chat area with alternating user/assistant messages, typing indicator, and message input with send button.',
    tags: ['chat', 'ai', 'messaging', 'interface', 'conversational'],
    featured: true,
    createdAt: '2026-06-10',
  },
  {
    slug: 'kanban-task-board',
    title: 'Kanban Task Board',
    description: 'A drag-style Kanban task management board with 3 columns (To Do, In Progress, Done), task cards with priority badges, assignee avatars, and due dates.',
    category: 'productivity',
    prompt: 'Build a task board with 3 columns: To Do, In Progress, Done. Each column has 3-4 task cards with title, assignee, priority badge (High/Medium/Low), and due date.',
    tags: ['kanban', 'task-management', 'project', 'board', 'productivity'],
    featured: true,
    createdAt: '2026-06-10',
  },
  {
    slug: 'ecommerce-product-page',
    title: 'E-Commerce Product Page',
    description: 'A complete product page with image gallery, pricing, star ratings, Add to Cart button, product specifications, and customer reviews section with sample reviews.',
    category: 'ecommerce',
    prompt: 'Build an e-commerce product page with image placeholder, price ($129.99), star rating, Add to Cart button, product specs table, and 3 customer reviews.',
    chatId: 'CoWsfKPVRE-Cv6WibBTwQ',
    tags: ['ecommerce', 'product', 'shopping', 'reviews', 'retail'],
    featured: false,
    createdAt: '2026-06-10',
  },
  {
    slug: 'saas-landing-page',
    title: 'SaaS Landing Page',
    description: 'A conversion-optimized SaaS landing page with hero section, feature cards with icons, social proof testimonials, pricing preview, and call-to-action footer.',
    category: 'landing',
    prompt: 'Build a SaaS landing page with hero section, 3 feature cards with icons, testimonials section, and a call-to-action footer with email signup.',
    tags: ['landing-page', 'saas', 'marketing', 'hero', 'conversion'],
    featured: true,
    createdAt: '2026-06-10',
  },
  {
    slug: 'blog-with-articles',
    title: 'Blog Layout',
    description: 'A clean blog layout with a featured article hero, article card grid with thumbnails, publish dates, read times, and category badges.',
    category: 'creative',
    prompt: 'Build a blog page with a featured article hero and a grid of 4 article cards with thumbnails, titles, dates, and read time.',
    chatId: 'I9Y81MMBnzERa2JP5wa6e',
    tags: ['blog', 'articles', 'content', 'publishing', 'media'],
    featured: false,
    createdAt: '2026-06-10',
  },
  {
    slug: 'music-player',
    title: 'Music Player',
    description: 'A beautiful music player interface with album artwork, track information, playback controls, progress bar, volume slider, and a playlist sidebar.',
    category: 'creative',
    prompt: 'Build a music player with album art, track info, playback controls (play/pause, skip, previous), progress bar, and a playlist sidebar with 8 songs.',
    chatId: 'WCX1pPXC5vsDZ81bkt_Px',
    tags: ['music', 'player', 'audio', 'media', 'entertainment'],
    featured: false,
    createdAt: '2026-06-10',
  },
  {
    slug: 'weather-dashboard',
    title: 'Weather Dashboard',
    description: 'A weather dashboard showing current conditions with temperature, humidity, and wind speed, plus a 5-day forecast with weather icons and high/low temperatures.',
    category: 'creative',
    prompt: 'Build a weather app showing current conditions (72F, Partly Cloudy, humidity 65%, wind 12 mph) and a 5-day forecast with weather icons.',
    chatId: 'OJ5uxtghr8W8iydgdyayW',
    tags: ['weather', 'forecast', 'dashboard', 'data', 'api'],
    featured: false,
    createdAt: '2026-06-10',
  },
]

/**
 * Generate an SEO-friendly slug from a title
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Generate SEO description from prompt
 */
export function generateDescription(prompt: string, title: string): string {
  return `${title} — AI-generated React component built with AINative Builder. ${prompt.substring(0, 120)}. Built with React, Tailwind CSS, and modern web technologies.`
}
