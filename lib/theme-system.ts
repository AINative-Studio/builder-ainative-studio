/**
 * AINative Theme System
 * 20 curated design system palettes for UI generation variety.
 * Each theme has: primary, dark, secondary, light, accent colors.
 * Themes are auto-selected based on app type/name, or randomly assigned.
 */

export interface ThemePalette {
  id: string
  name: string
  primary: string      // CTAs, buttons, active states, key accents
  primaryHover: string // Darker shade of primary for hover
  dark: string         // Dark surfaces, hero backgrounds, headers
  secondary: string    // Secondary actions, supporting elements
  light: string        // Light backgrounds, card surfaces
  accent: string       // Highlights, badges, alerts, special elements
  neutral: string      // Body text, muted elements
}

function darken(hex: string, amount: number = 20): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, (num >> 16) - amount)
  const g = Math.max(0, ((num >> 8) & 0x00FF) - amount)
  const b = Math.max(0, (num & 0x0000FF) - amount)
  return '#' + (r << 16 | g << 8 | b).toString(16).padStart(6, '0')
}

export const THEMES: ThemePalette[] = [
  {
    id: 'ai-agent-tech',
    name: 'AI Agent Tech',
    primary: '#2E4CA6', primaryHover: '#243D8A', dark: '#0A0E26', secondary: '#5983D9', light: '#F0F2F8', accent: '#EAF205', neutral: '#64748b',
  },
  {
    id: 'ai-travel',
    name: 'AI Travel',
    primary: '#038C4C', primaryHover: '#02703D', dark: '#0D0D0D', secondary: '#EFF288', light: '#F2EEB3', accent: '#038C4C', neutral: '#6B7280',
  },
  {
    id: 'lifeos-personal',
    name: 'LifeOS Personal',
    primary: '#F26241', primaryHover: '#D94E30', dark: '#261C16', secondary: '#F29580', light: '#FDF5F3', accent: '#F22816', neutral: '#A69A97',
  },
  {
    id: 'vectra-ecommerce',
    name: 'Vectra E-commerce',
    primary: '#F2357B', primaryHover: '#D92567', dark: '#260101', secondary: '#A68A56', light: '#F2F2F2', accent: '#40021F', neutral: '#6B7280',
  },
  {
    id: 'artlist-voiceover',
    name: 'Artlist Voiceover',
    primary: '#1F8DA6', primaryHover: '#1A7A90', dark: '#201126', secondary: '#3D4073', light: '#F0F5F7', accent: '#2E1D40', neutral: '#64748b',
  },
  {
    id: 'corti-healthtech',
    name: 'Corti HealthTech',
    primary: '#BF8339', primaryHover: '#A6702E', dark: '#1A1510', secondary: '#AAB7BF', light: '#DFE9F2', accent: '#BF532C', neutral: '#64748b',
  },
  {
    id: 'aims-dashcam',
    name: 'AIMS Dashcam',
    primary: '#D90D32', primaryHover: '#B80A29', dark: '#0D0D0D', secondary: '#4BA684', light: '#F0F4F3', accent: '#0D0540', neutral: '#34403B',
  },
  {
    id: 'tech-finance',
    name: 'Tech & Finance',
    primary: '#BF247A', primaryHover: '#A61D68', dark: '#1F4016', secondary: '#46858C', light: '#B5BFAE', accent: '#73200E', neutral: '#64748b',
  },
  {
    id: 'suno-ai',
    name: 'Suno AI',
    primary: '#0A37BF', primaryHover: '#082DA0', dark: '#0A0E26', secondary: '#4ED97F', light: '#F0F8F3', accent: '#D94E4E', neutral: '#64748b',
  },
  {
    id: 'ai-os',
    name: 'AI OS',
    primary: '#A772F2', primaryHover: '#9158E0', dark: '#1A1025', secondary: '#29733C', light: '#F8F0FE', accent: '#F24C3D', neutral: '#64748b',
  },
  {
    id: 'saerok-farming',
    name: 'SAEROK Farming',
    primary: '#79AEF2', primaryHover: '#6098E0', dark: '#1A2030', secondary: '#505907', light: '#D9D5C5', accent: '#D9C45B', neutral: '#64748b',
  },
  {
    id: 'digital-marketing',
    name: 'Digital Marketing',
    primary: '#049DBF', primaryHover: '#0387A6', dark: '#1A0A0C', secondary: '#A62D37', light: '#FFF8E6', accent: '#F2B705', neutral: '#64748b',
  },
  {
    id: 'loti-ai',
    name: 'Loti AI',
    primary: '#BF6E50', primaryHover: '#A65D42', dark: '#261C1E', secondary: '#736A65', light: '#F2EEEB', accent: '#BFB2AA', neutral: '#736A65',
  },
  {
    id: 'closetly-wardrobe',
    name: 'Closetly Wardrobe',
    primary: '#8C030E', primaryHover: '#73020B', dark: '#1A1210', secondary: '#A6937C', light: '#F2F2F2', accent: '#8C623E', neutral: '#73482F',
  },
  {
    id: 'ai-translation',
    name: 'AI Translation',
    primary: '#056CF2', primaryHover: '#045AD0', dark: '#0A1A30', secondary: '#0B688C', light: '#B0D1D9', accent: '#F21905', neutral: '#64748b',
  },
  {
    id: 'stratum-finance',
    name: 'Stratum Finance',
    primary: '#80BF41', primaryHover: '#6DA635', dark: '#0D0D0D', secondary: '#B1D923', light: '#F2F2F2', accent: '#F27405', neutral: '#64748b',
  },
  {
    id: 'mobile-ux',
    name: 'Mobile UX',
    primary: '#BF9BF2', primaryHover: '#A880E0', dark: '#1A1520', secondary: '#4F7302', light: '#C5D0D9', accent: '#BF3604', neutral: '#64748b',
  },
  {
    id: 'loamly-crm',
    name: 'Loamly CRM',
    primary: '#83A66A', primaryHover: '#708F5A', dark: '#1A1520', secondary: '#F294EC', light: '#F2F2F2', accent: '#5E734F', neutral: '#64748b',
  },
  {
    id: 'holo-dashboard',
    name: 'Holo Dashboard',
    primary: '#BAF241', primaryHover: '#A0D935', dark: '#0D0D0D', secondary: '#94BF36', light: '#F5F8F0', accent: '#F27244', neutral: '#64748b',
  },
  {
    id: 'geovea-assistant',
    name: 'Geovea Assistant',
    primary: '#03A65A', primaryHover: '#028A4B', dark: '#732210', secondary: '#F2B90C', light: '#F2C6B6', accent: '#A62B0F', neutral: '#64748b',
  },
]

/**
 * Select a theme based on app name/type or pick randomly.
 * Uses a hash of the app name for consistent but varied selection.
 */
export function selectTheme(prompt: string): ThemePalette {
  const lower = prompt.toLowerCase()

  // Keyword-based matching for best fit
  if (lower.includes('health') || lower.includes('medical') || lower.includes('clinic')) return THEMES[5]  // Corti HealthTech
  if (lower.includes('finance') || lower.includes('bank') || lower.includes('money') || lower.includes('payment')) return THEMES[15] // Stratum Finance
  if (lower.includes('ecommerce') || lower.includes('store') || lower.includes('shop') || lower.includes('product')) return THEMES[3]  // Vectra
  if (lower.includes('travel') || lower.includes('booking') || lower.includes('flight')) return THEMES[1]  // AI Travel
  if (lower.includes('music') || lower.includes('audio') || lower.includes('voice') || lower.includes('podcast')) return THEMES[4]  // Artlist
  if (lower.includes('crm') || lower.includes('sales') || lower.includes('customer')) return THEMES[17] // Loamly CRM
  if (lower.includes('fashion') || lower.includes('clothing') || lower.includes('wardrobe')) return THEMES[13] // Closetly
  if (lower.includes('farm') || lower.includes('agriculture') || lower.includes('garden')) return THEMES[10] // SAEROK
  if (lower.includes('marketing') || lower.includes('campaign') || lower.includes('ads')) return THEMES[11] // Digital Marketing
  if (lower.includes('translate') || lower.includes('language') || lower.includes('localize')) return THEMES[14] // AI Translation
  if (lower.includes('agent') || lower.includes('swarm') || lower.includes('monitor')) return THEMES[0]  // AI Agent Tech
  if (lower.includes('dashboard') || lower.includes('analytics')) return THEMES[18] // Holo Dashboard
  if (lower.includes('chat') || lower.includes('assistant') || lower.includes('bot')) return THEMES[9]  // AI OS
  if (lower.includes('mobile') || lower.includes('app')) return THEMES[16] // Mobile UX

  // Hash-based selection for consistent variety
  let hash = 0
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) - hash) + prompt.charCodeAt(i)
    hash |= 0
  }
  return THEMES[Math.abs(hash) % THEMES.length]
}

/**
 * Format theme as prompt injection for the system prompt.
 * Replaces the hardcoded AINative brand colors with the selected theme.
 */
export function formatThemeForPrompt(theme: ThemePalette): string {
  return `
## COLOR THEME — ${theme.name.toUpperCase()} PALETTE (USE THESE EXACT COLORS)

**Primary**: \`bg-[${theme.primary}]\` / \`text-[${theme.primary}]\` — CTAs, buttons, active states, key accents
**Primary Hover**: \`hover:bg-[${theme.primaryHover}]\`
**Dark Surfaces**: \`bg-[${theme.dark}]\` — hero backgrounds, headers, dark sections, sidebars
**Secondary**: \`bg-[${theme.secondary}]\` / \`text-[${theme.secondary}]\` — secondary actions, supporting elements
**Light**: \`${theme.light}\` — light backgrounds, card surfaces (use as bg-[${theme.light}] or bg-white)
**Accent**: \`bg-[${theme.accent}]\` / \`text-[${theme.accent}]\` — highlights, badges, alerts
**Neutral**: \`text-[${theme.neutral}]\` — body text, muted elements

**Hero sections**: Use \`bg-[${theme.dark}]\` with white text and decorative blur glows using primary color
**Cards**: \`bg-white border border-slate-200 shadow-ds-sm rounded-xl\`
**Primary buttons**: \`bg-[${theme.primary}] hover:bg-[${theme.primaryHover}] text-white\`
**Decorative glows**: Use \`bg-[${theme.primary}]/10\` and \`bg-[${theme.secondary}]/8\` with blur-[120px]
**Accent color word in hero headline**: \`<span className="text-[${theme.primary}]">keyword</span>\`
**Badge background**: \`bg-[${theme.primary}]/10 text-[${theme.primary}] border-[${theme.primary}]/20\`

IMPORTANT: Do NOT use #5867EF (the AINative brand purple). Use the theme colors above instead.
`
}
