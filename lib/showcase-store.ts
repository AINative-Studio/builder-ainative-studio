/**
 * Showcase Store — shared in-memory store for dynamic showcase entries.
 * Used by both the chat-ws route (to add) and the showcase API (to list).
 */

import { generateSlug, generateDescription, type ShowcaseEntry, SHOWCASE_CATEGORIES } from './showcase-data'

const MAX_ENTRIES = 200

// Use globalThis to share state across Next.js module instances
const globalStore = globalThis as unknown as { __showcaseDynamic?: ShowcaseEntry[] }
if (!globalStore.__showcaseDynamic) {
  globalStore.__showcaseDynamic = []
}
const dynamicEntries = globalStore.__showcaseDynamic

/**
 * Add a generation to the showcase
 */
export function addToShowcase(prompt: string, chatId: string, codeLength: number, generatedCode?: string): boolean {
  // Sanity floor only — surface every application. Reject empty/trivial output
  // (a bare scaffold with no real component is < ~200 chars) but keep small
  // valid apps (counters, notes) that the old 1500-char gate silently dropped.
  if (codeLength < 200) return false

  // Generate title from prompt
  const title = prompt
    .replace(/^Build\s+(a|an)\s+/i, '')
    .replace(/\.\s*$/, '')
    .split(/[.!]/)[0]
    .trim()
    .split(' ')
    .slice(0, 6)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  const slug = generateSlug(title) + '-' + chatId.slice(0, 6)

  // No duplicates
  if (dynamicEntries.find(e => e.chatId === chatId)) return false

  // Detect category
  const pl = prompt.toLowerCase()
  let category = 'creative'
  if (pl.includes('dashboard') || pl.includes('metric') || pl.includes('analytics')) category = 'dashboard'
  else if (pl.includes('landing') || pl.includes('pricing') || pl.includes('hero')) category = 'landing'
  else if (pl.includes('ecommerce') || pl.includes('product') || pl.includes('cart') || pl.includes('shop')) category = 'ecommerce'
  else if (pl.includes('chat') || pl.includes('social') || pl.includes('feed') || pl.includes('message')) category = 'social'
  else if (pl.includes('task') || pl.includes('kanban') || pl.includes('calendar') || pl.includes('setting')) category = 'productivity'
  else if (pl.includes('saas') || pl.includes('crm') || pl.includes('team') || pl.includes('project')) category = 'saas'

  // Extract tags
  const tagWords = ['dashboard', 'chart', 'table', 'form', 'card', 'grid', 'sidebar',
    'pricing', 'landing', 'hero', 'checkout', 'cart', 'chat', 'message', 'feed',
    'calendar', 'kanban', 'task', 'playlist', 'player', 'recipe', 'weather',
    'portfolio', 'blog', 'profile', 'settings', 'inventory', 'booking',
    'fitness', 'tracker', 'music', 'social', 'analytics', 'crm']
  const tags = tagWords.filter(t => pl.includes(t)).slice(0, 5)
  tags.push('ai-generated', 'react')

  const entry: ShowcaseEntry = {
    slug,
    title,
    description: generateDescription(prompt, title),
    category,
    prompt,
    chatId,
    generatedCode: generatedCode || undefined,
    tags,
    featured: false,
    createdAt: new Date().toISOString().split('T')[0],
  }

  dynamicEntries.unshift(entry)
  if (dynamicEntries.length > MAX_ENTRIES) dynamicEntries.pop()

  console.log(`📸 Showcase: added "${title}" (${codeLength} chars)`)
  return true
}

/**
 * Get all dynamic showcase entries
 */
export function getDynamicShowcase(): ShowcaseEntry[] {
  return [...dynamicEntries]
}
