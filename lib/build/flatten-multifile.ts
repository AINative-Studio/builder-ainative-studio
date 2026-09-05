/**
 * Flatten a multi-file app into ONE Babel-renderable module (builder#308).
 *
 * The single-file preview (/api/preview/{id}) renders only App.tsx and can't resolve
 * `./components/Header` — so a multi-file app (App imports Header/Hero/…) renders
 * blank on the shareable /build/{slug} page, which always uses that preview. Sandpack
 * fixes this in the live editor, but the share page is server-rendered HTML.
 *
 * This flattener inlines the local component files into App.tsx's scope: strip the
 * relative imports from App, strip each child's own imports/exports, concatenate the
 * children ABOVE App so their `function Header(){…}` become top-level bindings the
 * app's `<Header/>` resolves. External imports (react, recharts, lucide) are already
 * provided as globals by the preview scaffold, so we drop them too. The result is a
 * single module the hardened Babel path renders — no cross-file resolution needed.
 *
 * Conservative: only touches RELATIVE imports (`./` / `../`). If there are no local
 * imports, returns the App code unchanged (single-file apps are unaffected).
 */

const FILE_MARKER = /^\/\/\s*---\s*FILE:\s*(.+?)\s*---\s*$/

/**
 * Strip a wrapping markdown code fence (```jsx ... ``` / ```tsx ... ``` / bare
 * ``` ... ```), if present, before FILE-marker parsing (builder#499).
 *
 * `storePreview()` (app/api/chat-ws/route.ts) wraps the served code as
 * `` `\`\`\`jsx\n${finalContent}\n\`\`\`` `` before writing it to the in-memory
 * preview store, and `resolveStoredApp()` (lib/build/ready-gate.ts) reads that
 * store FIRST — so `raw` here is routinely the FENCED string, not the bare
 * FILE-marker blob. parseFiles() has no concept of code fences: it only splits
 * on `// --- FILE: ---` lines, so the closing ` ``` ` line was silently
 * appended as a trailing line of whichever file happened to be LAST in the
 * blob. That stray triple-backtick then parses as an unterminated template
 * literal once flattened — reproduced exactly in
 * __tests__/lib/build/flatten-multifile.test.ts ("fenced multi-file input").
 * This is the confirmed root cause of the register-app 422 syntax_error
 * false-positives on genuinely valid, successfully-generated apps.
 *
 * Conservative: only strips a fence that wraps the ENTIRE string (opening
 * fence on the first non-blank line, closing fence on the last non-blank
 * line) — a stray ``` appearing mid-file (e.g. inside a JSX text node) is left
 * untouched.
 */
function stripWrappingCodeFence(raw: string): string {
  const trimmed = (raw || '').trim()
  const m = trimmed.match(/^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n?```$/)
  return m ? m[1] : raw
}

/** Parse `// --- FILE: path ---` markers into { normalizedBasename: code }. */
export function parseFiles(raw: string): Record<string, string> {
  const files: Record<string, string> = {}
  let cur: string | null = null
  let buf: string[] = []
  for (const line of stripWrappingCodeFence(raw).split('\n')) {
    const m = line.match(FILE_MARKER)
    if (m) {
      if (cur) files[cur] = buf.join('\n').trim()
      cur = m[1].trim()
      buf = []
    } else buf.push(line)
  }
  if (cur) files[cur] = buf.join('\n').trim()
  return files
}

/** basename without extension, e.g. src/components/Header.tsx → Header */
function baseName(path: string): string {
  return path.replace(/\.[jt]sx?$/, '').split('/').pop() || path
}

/** Strip ALL import statements and leading `export ` keywords from a file body. */
function stripImportsAndExports(code: string): string {
  return code
    // whole import lines (single and multi-line handled by the `from '...'` anchor)
    .replace(/^\s*import\s+[^\n]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
    // `export default function X` → `function X` ; `export default X` dropped later
    .replace(/^\s*export\s+default\s+function/gm, 'function')
    .replace(/^\s*export\s+default\s+class/gm, 'class')
    .replace(/^\s*export\s+(const|let|function|class)/gm, '$1')
    // a trailing `export default Foo;` line (component already defined above)
    .replace(/^\s*export\s+default\s+\w+\s*;?\s*$/gm, '')
    .trim()
}

/** Does the App code import any LOCAL (relative) modules? */
export function hasLocalImports(appCode: string): boolean {
  return /^\s*import\s+[^\n]*?from\s*['"]\.\.?\//m.test(appCode || '')
}

/**
 * Flatten a multi-file marker string into a single module. If it's not multi-file
 * (no markers) or the App has no local imports, returns the extracted app code as-is.
 */
export function flattenMultiFile(raw: string): string {
  const files = parseFiles(raw)
  const paths = Object.keys(files)
  if (paths.length <= 1) {
    // Not multi-file — return unchanged. The preview route's existing extraction +
    // render already handles a single file (incl. its `export default`); flattening
    // is ADDITIVE, only for the multi-file case, so single-file stays a no-op.
    return paths.length === 1 ? files[paths[0]] : raw
  }

  // Find the entry (App.tsx / the file that imports the others).
  const appPath =
    paths.find((p) => /(^|\/)App\.[jt]sx?$/.test(p)) ||
    paths.find((p) => hasLocalImports(files[p])) ||
    paths[0]
  const appCode = files[appPath]

  if (!hasLocalImports(appCode)) {
    // App doesn't import siblings — single-file render is fine.
    return stripImportsAndExports(appCode)
  }

  // Map local module basenames → their file code, so we inline in dependency order.
  const byBase: Record<string, string> = {}
  for (const p of paths) if (p !== appPath) byBase[baseName(p)] = files[p]

  // Which local names does App import? Inline those (and any they transitively need).
  const inlined: string[] = []
  const seen = new Set<string>()
  const stubbed: string[] = []
  const inline = (code: string) => {
    for (const m of code.matchAll(/import\s+(?:(\w+)|\{([^}]*)\})\s+from\s*['"]\.\.?\/([^'"]+)['"]/g)) {
      const base = baseName(m[3])
      const child = byBase[base]
      const defaultName = m[1]
      if (child && !seen.has(base)) {
        seen.add(base)
        inline(child) // transitive deps first
        inlined.push(`// inlined from ${base}\n${stripImportsAndExports(child)}`)
      } else if (!child && defaultName && !seen.has(defaultName)) {
        // DANGLING import (builder#308): App imports a component the model never
        // emitted a file for (e.g. aerosol imported Cart/Footer with no Cart.tsx).
        // Rendering it undefined throws and blanks the app — emit a harmless stub
        // so the rest of the app renders. Better a missing section than a blank app.
        seen.add(defaultName)
        stubbed.push(`function ${defaultName}(props){ return null; } // stub: ${base} not emitted by generator`)
      }
    }
  }
  inline(appCode)

  const appBody = stripImportsAndExports(appCode)
  return [...stubbed, ...inlined, appBody].join('\n\n')
}
