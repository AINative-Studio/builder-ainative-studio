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
