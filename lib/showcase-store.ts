/**
 * Showcase Store — shared in-memory store for dynamic showcase entries.
 * Used by both the chat-ws route (to add) and the showcase API (to list).
 */

import { generateSlug, generateDescription, extractShowcaseTitle, type ShowcaseEntry, SHOWCASE_CATEGORIES } from './showcase-data'
import { isQualityApp } from './showcase-quality'

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
  // Real gap fixed 2026-09-10: this path had NO real quality gate at all — a
  // bare 200-char floor let every syntactically-valid-but-broken/degraded/
  // test generation straight into the public showcase (confirmed live: dozens
  // of duplicate junk entries from internal test traffic, on top of a
  // separate title-generation bug — see extractShowcaseTitle's doc). The
  // ZeroDB-backed listing path (app/api/showcase/route.ts) already applies
  // isQualityApp; this in-memory path must use the SAME gate, not a weaker
  // one, since both paths feed the same public gallery.
  if (!isQualityApp(generatedCode || '', chatId)) return false

  // Generate title from the REAL idea, not the generic template wrapper
  // every real prompt is embedded in (extractShowcaseTitle's doc has the
  // full story — this used to just take the prompt's first few words,
  // which was always the wrapper phrase, never the idea).
  const title = extractShowcaseTitle(prompt)

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
