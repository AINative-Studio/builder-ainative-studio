/**
 * Sandbox Builder Service
 *
 * Server-side renders a founder's generated React component by SSR-ing it
 * inside an isolated E2B (Firecracker microVM) sandbox and returns
 * self-contained HTML with Tailwind CDN.
 *
 * Approach: SSR (renderToString) → static HTML + Tailwind CDN
 * No JS bundle, no Babel, no Sandpack needed.
 *
 * #916: this previously POSTed to a self-hosted Railway executor URL that no
 * longer exists (confirmed live: real 404). Every call silently wasted a
 * network round-trip against a dead host before falling through to this
 * module's existing callers' own fallback behavior. The SSR render now runs inside
 * E2B via `runSequenceInE2BSandbox()` (lib/build/e2b-sandbox.ts) — the same,
 * already-proven primitive lib/build/coverage-runner.ts uses for the
 * coverage gate (#875) — so a founder's own generated component is never
 * executed unsandboxed on Builder's host process, and never depends on a
 * dead external URL. Mirrors isE2BEnabled()'s fail-closed pattern: when E2B
 * isn't configured, this returns an honest `{success:false}` rather than
 * attempting any network call or crashing.
 */

import { isE2BEnabled, runSequenceInE2BSandbox } from './build/e2b-sandbox'
import { detectRootComponent, applyComponentRewrite, hasDefaultExport as hasRealDefaultExport } from './component-detector'
import { findStringEnd, findBacktickEnd } from './build/bracket-scanner'

export interface BuildResult {
  success: boolean
  html: string
  buildTimeMs: number
  error?: string
}

const OUTPUT_FILE = 'output.html'
const RENDER_TIMEOUT_MS = 90_000

/**
 * Strip a markdown code fence wrapper, if present. PURE.
 */
function stripMarkdownFence(componentCode: string): string {
  const codeMatch = componentCode.match(/```(?:jsx|tsx|javascript|js|typescript)?\n([\s\S]*?)```/)
  return codeMatch ? codeMatch[1] : componentCode
}

const FILE_MARKER = /^\/\/\s*---\s*FILE:\s*(.+?)\s*---\s*$/

/**
 * Line indices (0-based) of `code` that sit INSIDE a still-open backtick
 * template literal or block comment (`/* ... *\/`) carried over from an
 * earlier line, rather than at top level. A single/double-quoted string or
 * a `//` line comment can never contain a literal newline in valid JS, so
 * they can't hide an embedded line this way — only these two multi-line
 * constructs can (same helper shape as flatten-multifile.ts's and
 * multi-file-parser.ts's `linesInsideMultilineConstruct`, #1933/#1939
 * class — this is that same bug class, found in this file's own
 * FILE_MARKER scan and import-strip scan, which neither of those fixes
 * covers).
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
 * Same-length mask of `code` with every string literal, template literal,
 * and comment span blanked to spaces (newlines preserved) — just enough
 * opacity to tell a decoy `export default` sitting inside a demo/example
 * string, template literal, or comment apart from a real one, using
 * bracket-scanner.ts's shared, already-proven string/backtick-end finders
 * rather than a fresh hand-rolled scanner.
 */
function maskStringsAndComments(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      const realEnd = end === -1 ? code.length - 1 : end
      out += code.slice(i, realEnd + 1).replace(/[^\n]/g, ' ')
      i = realEnd + 1
      continue
    }
    if (ch === '`') {
      const end = findBacktickEnd(code, i)
      const realEnd = end === -1 ? code.length - 1 : end
      out += code.slice(i, realEnd + 1).replace(/[^\n]/g, ' ')
      i = realEnd + 1
      continue
    }
    if (ch === '/' && next === '/') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      out += ' '.repeat(end - i)
      i = end
      continue
    }
    if (ch === '/' && next === '*') {
      let end = code.indexOf('*/', i + 2)
      end = end === -1 ? code.length : end + 2
      out += code.slice(i, Math.min(end, code.length)).replace(/[^\n]/g, ' ')
      i = Math.min(end, code.length)
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Applies `pattern` only to matches whose exact span is unchanged in
 * `masked` (i.e. real code, not a decoy sitting inside a string/comment
 * `masked` blanked out). `pattern` need not carry the `g` flag.
 */
function replaceOutsideMask(
  code: string,
  masked: string,
  pattern: RegExp,
  replacer: (match: RegExpExecArray) => string,
): string {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
  let result = ''
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const index = m.index
    const matchText = m[0]
    const isReal = masked.slice(index, index + matchText.length) === matchText
    result += code.slice(lastIndex, index)
    result += isReal ? replacer(m) : matchText
    lastIndex = index + matchText.length
  }
  result += code.slice(lastIndex)
  return result
}

/**
 * `finalContent` reaching buildInSandbox() can be the RAW multi-file
 * generator output (`// --- FILE: path --- ` markers, same format
 * lib/multi-file-parser.ts splits) — confirmed live: chat-ws/route.ts's
 * background "instant preview" SSR call passes it through unconditionally,
 * with no multi-file check. detectComponentName()/buildRenderScript() below
 * only understand a single file's worth of code: fed the whole raw blob,
 * detectComponentName()'s un-flagged regex grabs the FIRST
 * `export default function Name` in the ENTIRE blob, which is a sibling
 * component's if the model emitted it before the real App/page file. The
 * frozen SSR snapshot then silently renders that sibling fragment instead
 * of the founder's real app (app/api/preview/[id]/route.ts serves this
 * exact snapshot as a fallback when there's no live code to re-render).
 * Extract just the App/page file's own content first so the single-file
 * assumption below actually holds. PURE.
 */
function extractMainFileContent(rawOutput: string): string {
  const lines = rawOutput.split('\n')
  const hiddenLines = linesInsideMultilineConstruct(rawOutput)
  const files: Record<string, string> = {}
  let currentFile: string | null = null
  let currentContent: string[] = []
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const match = hiddenLines.has(idx) ? null : line.match(FILE_MARKER)
    if (match) {
      if (currentFile) files[currentFile] = currentContent.join('\n').trim()
      currentFile = match[1].trim()
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }
  if (currentFile) files[currentFile] = currentContent.join('\n').trim()

  // No markers found at all -- genuinely single-file input, untouched.
  const names = Object.keys(files)
  if (names.length === 0) return rawOutput

  const mainFile =
    names.find(f => /(^|\/)App\.tsx$/i.test(f)) ||
    names.find(f => /(^|\/)page\.tsx$/i.test(f)) ||
    names[0]

  return mainFile ? files[mainFile] : rawOutput
}

/**
 * Detect the founder's component to render. Delegates to the canonical
 * detectRootComponent() (lib/component-detector.ts) — the same detector
 * lib/sandpack/build-files.ts, lib/multi-file-parser.ts, and both
 * app/api/preview/* routes already use — rather than a bespoke regex that
 * only understood `export default function Name` and a bare `export {
 * Name }` list. The bespoke version's miss (an identified-but-not-inline
 * default export like `export default Dashboard;`, or any anonymous/class
 * default export) used to fall through to a hardcoded 'App' guess; that was
 * usually masked downstream by buildRenderScript()'s own generic
 * `globalThis.__Default__` fallback, but NOT when the wrong guessed name
 * happened to collide with something else already bound on `globalThis`
 * (e.g. a Lucide icon of the same name, bound before "Component code" runs)
 * — the wrong value would win over the real component. Returns the
 * (possibly rewritten) code alongside the name: an anonymous default export
 * has no name to bind, so detectRootComponent() supplies a `rewrite` that
 * must be applied to the source BEFORE buildRenderScript() does its own
 * `export default` stripping, exactly as app/api/preview/route.ts and
 * showcase-client.tsx already do.
 */
function detectComponentName(code: string): { name: string; code: string } {
  const detection = detectRootComponent(code)
  // Via applyComponentRewrite(), which splices at the match's own `index`
  // instead of a blind `code.replace(find, replace)` — a plain text replace
  // would rewrite a decoy occurrence of the same short, generic text (e.g.
  // inside an earlier comment) instead of the real declaration, leaving the
  // real one unnamed (see lib/component-detector.ts's `rewrite` doc comment).
  const out = applyComponentRewrite(code, detection.rewrite)
  return { name: detection.name || 'App', code: out }
}

/**
 * Build the Node/JSX render script that SSRs the founder's component and
 * writes the resulting HTML to OUTPUT_FILE inside the sandbox. PURE (string
 * templating only — no I/O).
 */
function buildRenderScript(rawCode: string, compName: string): string {
  // Strip import statements (we provide everything via require/globals).
  //
  // Real bug found live (same sweep as #1933/#1939): this was a plain
  // `rawCode.replace(/^import\s+.*from\s+['"].*['"];?\s*$/gm, '')` with no
  // notion of a line sitting inside an earlier line's own open backtick
  // template literal or block comment. A demo/example snippet shown on the
  // page (e.g. `const demo = \`\nimport Foo from 'foo-sdk'\n\``, an ordinary
  // docs/SDK-landing-page pattern) had that display-only line silently
  // deleted, corrupting the literal's own content with no error.
  const hiddenImportLines = linesInsideMultilineConstruct(rawCode)
  let code = rawCode
    .split('\n')
    .map((line, idx) => (hiddenImportLines.has(idx) ? line : line.replace(/^import\s+.*from\s+['"].*['"];?\s*$/, '')))
    .join('\n')

  // Handle export default — convert to a globalThis assignment so the
  // render script below can find it without a module system.
  //
  // `hasDefaultExport` must be the shared, comment/string-aware check from
  // component-detector.ts, not a plain `/export\s+default\s+/.test(code)`
  // regex — a bare `export { Name }`-only file that merely MENTIONS "export
  // default" inside a comment or string (e.g. `// TODO: add export default
  // Name later`) made the naive regex wrongly report true, which skipped the
  // `exposeBareExport` fallback below with no real `export default` for the
  // replace() calls after it to convert either — `Comp` then resolves to
  // `null` and the SSR preview silently shows the "Component not found"
  // placeholder in place of the founder's real app.
  const hasDefaultExport = hasRealDefaultExport(code)

  // Same comment/string-blindness bug class as the import strip above, but
  // these two regexes are unanchored (not `^...$`), so a decoy can also sit
  // mid-line inside a same-line string, not just inside a multi-line
  // construct — e.g. `const label = "export default demo"` — hence the
  // full char-level mask rather than the per-line check used above.
  // `masked` is recomputed before each pass: the first pass changes
  // `code`'s length/content (`export default function Foo` is a different
  // length than `globalThis.Foo = function Foo`), so a mask computed once
  // up front would be misaligned with `code`'s offsets by the second pass.
  code = replaceOutsideMask(
    code,
    maskStringsAndComments(code),
    /export\s+default\s+function\s+(\w+)/g,
    (m) => `globalThis.${m[1]} = function ${m[1]}`,
  )
  code = replaceOutsideMask(code, maskStringsAndComments(code), /export\s+default\s+/g, () => 'globalThis.__Default__ = ')

  // #1541-class gap: a component declared plainly and exported only via a
  // trailing bare `export { Name }` list (no `export default` anywhere) has
  // no globalThis assignment at all from the regexes above — `compName` is
  // still the real declared identifier (detectComponentName() resolves it
  // from the same bare list), so expose it directly by referencing it in
  // its own declaration scope. `typeof` guards against a ReferenceError if
  // detection still guessed wrong.
  const exposeBareExport = hasDefaultExport
    ? ''
    : `try { globalThis['${compName}'] = typeof ${compName} !== 'undefined' ? ${compName} : globalThis['${compName}']; } catch (e) {}`

  return `
const React = require('react');
const { useState, useEffect, useMemo, useCallback, useRef, Fragment } = React;
const { renderToString } = require('react-dom/server');
const fs = require('fs');
const LucideIcons = require('lucide-react');

// Make all Lucide icons available as globals
Object.entries(LucideIcons).forEach(([name, icon]) => {
  if (typeof icon === 'function' || typeof icon === 'object') {
    globalThis[name] = icon;
  }
});

// Stub shadcn/ui components
const stubDiv = ({children, className, ...p}) => React.createElement('div', {className, ...p}, children);
const stubBtn = ({children, className, ...p}) => React.createElement('button', {className: 'px-4 py-2 rounded-lg ' + (className||''), ...p}, children);
['Card','CardHeader','CardTitle','CardDescription','CardContent','CardFooter',
 'Badge','Input','Label','Separator','Avatar','AvatarImage','AvatarFallback',
 'Select','SelectTrigger','SelectValue','SelectContent','SelectItem',
 'Table','TableHeader','TableBody','TableRow','TableHead','TableCell',
 'Tabs','TabsList','TabsTrigger','TabsContent','Progress',
 'MetricCard','AIKitTable','AIKitHeader','AIKitSidebar','AIKitRating','AIKitAvatar',
 'EmptyState','Skeleton'].forEach(n => { globalThis[n] = stubDiv; });
globalThis.Button = stubBtn;

// Stub recharts
const chartStub = ({children, className, ...p}) => React.createElement('div', {
  className: 'bg-gray-100 rounded-lg p-8 flex items-center justify-center text-gray-400 text-sm ' + (className||''),
  style: { height: p.height || 200, width: '100%' }
}, children || '[Chart]');
['BarChart','LineChart','AreaChart','PieChart','RadarChart',
 'Bar','Line','Area','Pie','Cell','XAxis','YAxis','CartesianGrid',
 'Tooltip','Legend','ResponsiveContainer','RadialBarChart'].forEach(n => { globalThis[n] = chartStub; });

// Component code
${code}
${exposeBareExport}

// Find and render the component
const Comp = globalThis['${compName}'] || globalThis.__Default__ || null;
try {
  if (Comp) {
    const html = renderToString(React.createElement(Comp));
    fs.writeFileSync('${OUTPUT_FILE}', html, 'utf8');
  } else {
    fs.writeFileSync('${OUTPUT_FILE}', '<div style="padding:2rem;color:#999">Component not found</div>', 'utf8');
  }
} catch (e) {
  console.error('SSR_RENDER_ERROR: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
}
`
}

const PACKAGE_JSON = JSON.stringify({
  name: 'ssr',
  dependencies: {
    'react': '^18',
    'react-dom': '^18',
    'lucide-react': '^0.400.0',
    'recharts': '^2.12.0',
    'esbuild': '^0.20.0',
    'esbuild-register': '^3.5.0',
  },
})

/**
 * Wrap raw rendered HTML in a full HTML page with Tailwind CDN.
 */
function wrapHtmlPage(renderedHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}</style>
</head>
<body>
  ${renderedHtml}
</body>
</html>`
}

/**
 * SSR a React component inside an isolated E2B sandbox and return
 * self-contained HTML.
 */
export async function buildInSandbox(componentCode: string): Promise<BuildResult> {
  const startTime = Date.now()

  if (!isE2BEnabled()) {
    return {
      success: false,
      html: '',
      buildTimeMs: Date.now() - startTime,
      error: 'E2B is not configured (E2B_API_KEY unset) — cannot SSR-render in a sandbox.',
    }
  }

  const stripped = extractMainFileContent(stripMarkdownFence(componentCode))
  const { name: compName, code: detectedCode } = detectComponentName(stripped)
  const renderScript = buildRenderScript(detectedCode, compName)

  try {
    const session = await runSequenceInE2BSandbox(
      {
        'package.json': PACKAGE_JSON,
        'render.jsx': renderScript,
      },
      [
        { command: 'npm', args: ['install', '--no-audit', '--no-fund'] },
        { command: 'node', args: ['-r', 'esbuild-register', 'render.jsx'] },
      ],
      { timeoutMs: RENDER_TIMEOUT_MS, readBack: [OUTPUT_FILE] },
    )

    const buildTimeMs = Date.now() - startTime

    if (session.sandboxError) {
      return { success: false, html: '', buildTimeMs, error: `E2B sandbox unavailable: ${session.sandboxError}` }
    }

    const [install, render] = session.commandResults

    if (!install || install.exitCode !== 0) {
      return {
        success: false,
        html: '',
        buildTimeMs,
        error: install?.timedOut
          ? `npm install timed out after ${RENDER_TIMEOUT_MS}ms (E2B sandbox)`
          : `npm install failed (exit ${install?.exitCode ?? 'unknown'}) (E2B sandbox): ${install?.stderr?.slice(-500) ?? ''}`,
      }
    }

    if (!render) {
      return { success: false, html: '', buildTimeMs, error: 'SSR render did not produce a result (E2B sandbox)' }
    }

    if (render.timedOut) {
      return { success: false, html: '', buildTimeMs, error: `SSR render timed out after ${RENDER_TIMEOUT_MS}ms (E2B sandbox)` }
    }

    if (render.exitCode !== 0) {
      return {
        success: false,
        html: '',
        buildTimeMs,
        error: `SSR render failed (exit ${render.exitCode}) (E2B sandbox): ${(render.stderr || render.stdout || '').slice(-500)}`,
      }
    }

    const renderedHtml = session.files[OUTPUT_FILE]
    if (typeof renderedHtml !== 'string' || renderedHtml.length === 0) {
      return { success: false, html: '', buildTimeMs, error: 'SSR render produced no readable output file (E2B sandbox)' }
    }

    const fullHtml = wrapHtmlPage(renderedHtml)
    console.log(`[Sandbox] SSR success: ${renderedHtml.length} bytes rendered, ${fullHtml.length} bytes total, ${buildTimeMs}ms`)
    return { success: true, html: fullHtml, buildTimeMs }
  } catch (e: any) {
    return { success: false, html: '', buildTimeMs: Date.now() - startTime, error: e?.message || String(e) }
  }
}
