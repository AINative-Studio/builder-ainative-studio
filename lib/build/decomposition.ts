/**
 * Server-side decomposition pass (#293 · Phase 5, epic #296).
 *
 * Live prod capture proved the model (Bedrock Sonnet) IGNORES the multi-file
 * directive for complex ideas — it returns a single App.tsx blob (a 5-surface CRM
 * came back as one 12KB file, zero `// --- FILE:` markers), so multiFile=0% and
 * complex apps stay shallow. Strengthening the prompt didn't move it.
 *
 * This pass is the deterministic fix: when a COMPLEX idea yields a SINGLE large
 * source file with NO file markers, run ONE bounded LLM pass that splits it into
 * `src/App.tsx` + `src/components/*.tsx` using the marker format the parser expects.
 * It's a refactor (no behavior change), so it's low-risk, and it only fires when
 * warranted — a simple single-view app is never decomposed.
 *
 * Pure + deterministic decision logic here; the LLM call is injected by the caller
 * so this module stays testable without the network.
 */

/** Does the code already have file markers (i.e. the model volunteered multi-file)? */
export function hasFileMarkers(code: string): boolean {
  return /\/\/\s*---\s*FILE:/.test(code || '')
}

/**
 * Should we run the decomposition pass?
 *  - the idea warrants multi-file (caller passes the same wantsMultiFile signal), AND
 *  - the code is a SINGLE file (no markers), AND
 *  - it's large enough that splitting is worthwhile (a thin stub isn't worth a pass;
 *    it needs enrichment, not decomposition).
 */
export function shouldDecompose(code: string, wantsMultiFile: boolean, minChars = 3500): boolean {
  const src = code || ''
  if (!wantsMultiFile) return false
  if (hasFileMarkers(src)) return false
  return src.length >= minChars
}

/**
 * Combined obedience-fix + decomposition prompt (#305). When an app both has
 * obedience gaps AND warrants multi-file, doing two sequential Claude passes pushed
 * the heaviest builds past the client SSE window. This does BOTH in one pass: apply
 * the rule fixes, THEN split into files — one call instead of two. `obedienceFixes`
 * is the buildObediencePrompt() text (the specific /api/db + AIKit gaps to fix).
 */
export function buildFixAndDecomposePrompt(idea: string, obedienceFixes: string, singleFileCode: string): string {
  return [
    `You will improve AND split a working React app (idea: "${idea}") in ONE step.`,
    ``,
    `STEP 1 — apply these fixes (keep every feature, change nothing else):`,
    obedienceFixes,
    ``,
    `STEP 2 — then split the corrected app into MULTIPLE files:`,
    `- src/App.tsx composes the sections via relative imports`,
    `- one file per major section/component under src/components/`,
    `- output EVERY file with a marker line in EXACTLY this format (nothing before the first marker):`,
    ``,
    `// --- FILE: src/App.tsx ---`,
    `<code>`,
    `// --- FILE: src/components/Sidebar.tsx ---`,
    `<code>`,
    ``,
    `Rules: relative imports, every import resolves, keep all state/handlers/api-db calls`,
    `and AIKit components. Return ONLY the files.`,
    ``,
    `CURRENT APP:`,
    '```jsx',
    singleFileCode.slice(0, 16000),
    '```',
  ].join('\n')
}

/**
 * Build the decomposition prompt. Instructs a split-only refactor into the exact
 * marker format the multi-file parser consumes, preserving every feature.
 */
export function buildDecompositionPrompt(idea: string, singleFileCode: string): string {
  return [
    `You are refactoring a working single-file React app into MULTIPLE files. Do NOT`,
    `add, remove, or change any feature or behavior — this is a pure structural split.`,
    ``,
    `The app (idea: "${idea}") is currently one large file. Split it into:`,
    `- src/App.tsx — the default-export entry that composes the sections via relative imports`,
    `- one file per major section/component under src/components/ (e.g. Sidebar, the table,`,
    `  the kanban board, the activity feed, the charts/reports)`,
    `- shared types/helpers under src/lib/ if present`,
    ``,
    `Output EVERY file with a marker line in EXACTLY this format (nothing before the first marker):`,
    ``,
    `// --- FILE: src/App.tsx ---`,
    `<code>`,
    `// --- FILE: src/components/Sidebar.tsx ---`,
    `<code>`,
    ``,
    `Rules: use relative imports (import Sidebar from "./components/Sidebar"). Keep all`,
    `state, handlers, /api/db calls, and AIKit components exactly as they are — just move`,
    `them into the right files. Every import must resolve. Return ONLY the files.`,
    ``,
    `CURRENT SINGLE-FILE APP:`,
    '```jsx',
    singleFileCode.slice(0, 16000),
    '```',
  ].join('\n')
}
