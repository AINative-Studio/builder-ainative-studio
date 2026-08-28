/**
 * Multi-file codegen emphasis (#291) — nudges the model toward the file structure
 * appropriate to an idea's complexity.
 *
 * The PROFESSIONAL_SYSTEM_PROMPT already documents the multi-file OUTPUT FORMAT
 * (// --- FILE: … --- markers, split into components). But without a scope cue the
 * model defaults to a single blob for most ideas. This block, appended to the
 * system prompt, makes the choice explicit and complexity-driven:
 *
 *   - complex → REQUIRE multi-file (splits into components → renders via Sandpack).
 *   - medium  → PREFER multi-file when there are distinct sections.
 *   - simple  → a single lean file is fine (renders via the fast Babel path).
 *
 * Keeping it complexity-gated means we don't force overhead onto a simple counter
 * app, and we don't cram a full dashboard into one unmaintainable file.
 */

export type IdeaComplexity = 'simple' | 'medium' | 'complex'

/**
 * Whether an idea warrants MULTI-FILE output (#291) — a purpose-built signal, NOT
 * the analyzeComplexity() score (that under-counts raw ideas: a full CRM/dashboard
 * still scores "simple" because its PRD parser finds ~0 features). Instead we count
 * how many DISTINCT app "surfaces" the idea names. An app with several sections
 * (sidebar + table + kanban + charts + settings) is exactly the multi-file case;
 * a counter or a single landing page is not.
 *
 * Returns true when the idea references >= 3 distinct surfaces, or explicitly asks
 * for multiple pages/sections. Deliberately conservative — false → the fast
 * single-file Babel path, which is never a regression.
 */
const SURFACE_TERMS = [
  'sidebar', 'navbar', 'nav bar', 'navigation',
  'dashboard', 'kanban', 'board',
  'table', 'grid', 'list view', 'data table',
  'chart', 'graph', 'analytics', 'report',
  'feed', 'timeline', 'activity',
  'settings', 'profile', 'account',
  'calendar', 'schedule',
  'form', 'checkout', 'cart',
  'panel', 'modal', 'drawer',
  'pipeline', 'inbox', 'messages', 'chat',
  'gallery', 'map',
]

/**
 * Complex app ARCHETYPES (#293). A terse idea like "a CRM" or "an analytics
 * dashboard" names ZERO surface terms yet inherently has many surfaces (list +
 * detail + filters + charts + settings). The surface-count heuristic alone scored
 * these single-file (multiFile=0% in prod verify), producing shallow complex apps.
 * Naming a known archetype is itself sufficient signal for multi-file output.
 */
const COMPLEX_ARCHETYPES = [
  'crm', 'dashboard', 'admin panel', 'admin dashboard', 'analytics',
  'marketplace', 'ecommerce', 'e-commerce', 'online store', 'storefront',
  'project management', 'kanban', 'issue tracker', 'help ?desk', 'ticketing',
  'social network', 'social media', 'forum', 'community',
  'booking', 'reservation', 'scheduling', 'appointment',
  'inventory', 'point of sale', 'pos system', 'erp',
  'learning management', 'lms', 'content management', 'cms',
  'invoicing', 'accounting', 'billing', 'expense',
  'pipeline', 'sales pipeline', 'lead', 'deal',
]

/**
 * Explicit multi-page / multi-section asks (plural intent only — "landing page
 * for a shop" must NOT match, so no bare "page for").
 */
export function hasExplicitMultiPageAsk(idea: string): boolean {
  const text = (idea || '').toLowerCase()
  return /\b(multi-?page|multiple (pages|sections|screens|views)|several (pages|sections|screens|views))\b/.test(text)
}

/**
 * True when the idea names a known complex archetype (#293) — these have many
 * surfaces even when the idea string is terse (e.g. "a CRM", "a dashboard").
 */
export function namesComplexArchetype(idea: string): boolean {
  const text = (idea || '').toLowerCase()
  for (const arch of COMPLEX_ARCHETYPES) {
    if (new RegExp(`\\b${arch}\\b`).test(text)) return true
  }
  return false
}

/**
 * DISTINCT app surfaces named by the idea (deduped: "nav bar"⊂"navbar" won't
 * double count because we match on whole words and normalize whitespace).
 * Exported for the complexity analyzer (#342) so chunking thresholds and the
 * multi-file gate share ONE surface vocabulary.
 */
export function detectIdeaSurfaces(idea: string): string[] {
  const text = (idea || '').toLowerCase()
  if (!text.trim()) return []
  const seen = new Map<string, string>() // normalized key → display term
  for (const term of SURFACE_TERMS) {
    // Plural-tolerant: "reports"/"charts"/"forms" name the same surface as the
    // singular term (#342 — singular-only matching under-counted real ideas).
    const re = new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}s?\\b`)
    const key = term.replace(/\s+/g, '')
    if (re.test(text) && !seen.has(key)) seen.set(key, term)
  }
  return Array.from(seen.values())
}

export function ideaWarrantsMultiFile(idea: string): boolean {
  const text = (idea || '').toLowerCase()
  if (!text.trim()) return false

  if (hasExplicitMultiPageAsk(text)) return true

  // A named complex archetype is sufficient on its own (#293).
  if (namesComplexArchetype(text)) return true

  return detectIdeaSurfaces(text).length >= 3
}

export function multiFileEmphasis(complexity: IdeaComplexity): string {
  if (complexity === 'complex') {
    return [
      '',
      '## FILE STRUCTURE FOR THIS BUILD — MULTI-FILE REQUIRED',
      'This is a COMPLEX app. Do NOT put everything in one file. Split it using the',
      'multi-file OUTPUT FORMAT above (// --- FILE: … --- markers):',
      '- `src/App.tsx` composes the app and imports the section/feature components.',
      '- One file per major section or feature (e.g. src/components/Dashboard.tsx,',
      '  src/components/Sidebar.tsx, src/components/DataTable.tsx).',
      '- Shared helpers/types in their own files (src/lib/*.ts).',
      'Use relative imports between files. Aim for real, maintainable structure — the',
      'preview renders multi-file apps with a real bundler.',
    ].join('\n')
  }
  if (complexity === 'medium') {
    return [
      '',
      '## FILE STRUCTURE FOR THIS BUILD — PREFER MULTI-FILE',
      'If this app has distinct sections/features, split them into separate component',
      'files using the multi-file OUTPUT FORMAT above (// --- FILE: … --- markers)',
      'with `src/App.tsx` composing them.',
      'If it is genuinely a single view, one file is acceptable.',
    ].join('\n')
  }
  // simple
  return [
    '',
    '## FILE STRUCTURE FOR THIS BUILD — SINGLE FILE IS FINE',
    'This is a SIMPLE app. A single self-contained `src/App.tsx` is fine — no need to',
    'split into multiple files. Prioritize a fast, correct, complete single component.',
  ].join('\n')
}

/**
 * A concise multi-file directive to PREPEND to the USER message for a complex idea
 * (#291). System-prompt emphasis alone proved too weak — the 44K-char prompt is
 * dense with single-`App()` examples, so the model kept emitting one file. The user
 * message is weighted far more heavily and sits right next to the request, so the
 * directive lands here with the EXACT marker format shown inline for the model to
 * copy. Only used for complex ideas; simple/medium keep the default behavior.
 */
export function multiFileUserDirective(): string {
  return [
    'IMPORTANT — OUTPUT THIS AS MULTIPLE FILES. This app is complex, so split it into',
    'separate component files. Emit each file with a marker line in EXACTLY this format:',
    '',
    '// --- FILE: src/App.tsx ---',
    '<code for App.tsx — imports and composes the sections>',
    '// --- FILE: src/components/Sidebar.tsx ---',
    '<code for Sidebar.tsx>',
    '// --- FILE: src/components/<Section>.tsx ---',
    '<code for each major section/feature>',
    '',
    'Rules: src/App.tsx is the default-export entry that imports the section components',
    'with relative imports (e.g. import Sidebar from "./components/Sidebar"). Put each',
    'major section/feature in its own file. Do NOT put everything in one file.',
    '',
  ].join('\n')
}
