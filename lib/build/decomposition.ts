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

/**
 * Line indices (0-based) of `code` that sit INSIDE a still-open backtick
 * template literal or block comment carried over from an earlier line,
 * rather than at top level — same helper shape as sandbox-builder.ts's/
 * multi-file-parser.ts's `linesInsideMultilineConstruct` (#1933/#1939
 * class). A single/double-quoted string or a `//` line comment can't
 * contain a literal newline in valid JS, so only these two multi-line
 * constructs can hide an embedded line this way.
 */
function linesInsideMultilineConstruct(code: string): Set<number> {
  const inside = new Set<number>()
  const markSpan = (from: number, to: number, line: number): number => {
    for (let j = from; j < to; j++) if (code[j] === '\n') { line++; inside.add(line) }
    return line
  }
  let line = 0
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '\\') { i += 2; continue }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < code.length && code[j] !== ch) { if (code[j] === '\\') j++; j++ }
      i = j + 1
      continue
    }
    if (ch === '/' && next === '/') {
      const end = code.indexOf('\n', i)
      i = end === -1 ? code.length : end
      continue
    }
    if (ch === '`') {
      let j = i + 1
      while (j < code.length && code[j] !== '`') { if (code[j] === '\\') j++; j++ }
      const stop = j >= code.length ? code.length : j + 1
      line = markSpan(i, stop, line)
      i = stop
      continue
    }
    if (ch === '/' && next === '*') {
      const closeIdx = code.indexOf('*/', i + 2)
      const stop = closeIdx === -1 ? code.length : closeIdx + 2
      line = markSpan(i, stop, line)
      i = stop
      continue
    }
    if (ch === '\n') { line++; i++; continue }
    i++
  }
  return inside
}

/**
 * Does the code already have file markers (i.e. the model volunteered
 * multi-file)? Real bug found live (this loop's overnight comment/string-
 * blindness sweep, #1933/#1939/#1945/#1949/#1962/#1977/#1978/#1981/#1983
 * class): this used to `.test()` the raw, unmasked code directly, so a
 * decoy marker-shaped line sitting inside an earlier line's own open
 * backtick template literal or block comment (e.g. a generated docs page
 * demonstrating this project's own multi-file convention) was mistaken for
 * a real marker on genuinely single-file code — silently defeating
 * shouldDecompose() for exactly the "complex idea stuck in one giant file"
 * case this module exists to fix.
 */
export function hasFileMarkers(code: string): boolean {
  const src = code || ''
  const hidden = linesInsideMultilineConstruct(src)
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!hidden.has(i) && /\/\/\s*---\s*FILE:/.test(lines[i])) return true
  }
  return false
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
    // Real bug found live (Meridian, 2026-09-10, chat-ws.ts's sibling
    // obedience-only repair pass): a real generation routinely runs
    // 25k-32k chars, well past a 16000-char cutoff here too — told to "keep
    // every feature" while unable to see the back half of its own code, the
    // model re-references components it can no longer see the real import
    // for. Matched to the same generous 32000 limit used there.
    singleFileCode.slice(0, 32000),
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
    // Matched to the same generous 32000 limit as buildFixAndDecomposePrompt
    // above, for the same reason (real generations routinely exceed 16000
    // chars — see that function's comment).
    singleFileCode.slice(0, 32000),
    '```',
  ].join('\n')
}
