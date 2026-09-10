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

/**
 * Package names whose imported bindings are ACTUALLY pre-bound as bare
 * globals by the preview scaffold before this flattened code runs (confirmed
 * via app/api/preview/[id]/route.ts: React/hooks are assigned onto `window`
 * directly; `lucide-react` icon names are bound via a `_getIcon` walk; the
 * fixed `recharts` chart-component names are destructured from
 * `window.Recharts`). Stripping an import from one of these is genuinely
 * safe — the names it would have bound already exist by the time this code
 * executes.
 */
const GLOBALLY_PROVIDED_PACKAGES = new Set(['react', 'react-dom', 'lucide-react', 'recharts'])

/**
 * Real bug found live (Dispatch, 2026-09-11): stripImportsAndExports used to
 * strip EVERY import line unconditionally, including named imports from
 * arbitrary external packages (e.g. `import { Card, Button, Dialog, Input }
 * from '@radix-ui/react-dialog'` — a real generation's hallucinated import,
 * naming shadcn/ui-style components @radix-ui/react-dialog doesn't actually
 * export). The doc comment's claim that "external imports are already
 * provided as globals" is only true for GLOBALLY_PROVIDED_PACKAGES above —
 * everything else has NOTHING backing those names. The flattened code then
 * referenced Card/Button/Dialog/etc. as bare, wholly undeclared identifiers,
 * threw at render, and the ErrorBoundary swallowed it into the degraded
 * "Refining your app" state — the real UI never painted, matching the
 * customer-reported "basic UI components are missing."
 *
 * Fixed the same way #308 already handles a DANGLING local import (a
 * generator-side mistake this flattener can't correct, but CAN degrade
 * gracefully from): any named import from a package NOT in
 * GLOBALLY_PROVIDED_PACKAGES gets each of its named bindings replaced with a
 * harmless stub (a no-op component for PascalCase names, `undefined` for
 * anything else) instead of silently vanishing — better a missing/blank
 * section than the whole app throwing before anything renders.
 */
function stripImportsAndExports(code: string): string {
  const stubs: string[] = []
  const stubbed = new Set<string>()

  const withStubbedExternals = code.replace(
    /^\s*import\s+(?:(\w+)\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm,
    (full, defaultName: string | undefined, named: string, pkg: string) => {
      if (GLOBALLY_PROVIDED_PACKAGES.has(pkg) || pkg.startsWith('./') || pkg.startsWith('../')) return full
      const names = [
        ...(defaultName ? [defaultName] : []),
        ...named.split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean),
      ]
      for (const name of names) {
        if (stubbed.has(name)) continue
        stubbed.add(name)
        stubs.push(
          /^[A-Z]/.test(name)
            ? `function ${name}(props){ return (props && props.children) || null; } // stub: '${pkg}' import not backed by the preview scaffold`
            : `const ${name} = undefined; // stub: '${pkg}' import not backed by the preview scaffold`,
        )
      }
      return ''
    },
  )

  const stripped = withStubbedExternals
    // whole import lines (single and multi-line handled by the `from '...'` anchor)
    // — local/relative and now-stubbed-external ones are already gone above;
    // this still needs to remove the GLOBALLY_PROVIDED_PACKAGES imports and
    // any bare default-only import this session's regex above didn't match.
    .replace(/^\s*import\s+[^\n]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
    // `export default function X` → `function X` ; `export default X` dropped later
    .replace(/^\s*export\s+default\s+function/gm, 'function')
    .replace(/^\s*export\s+default\s+class/gm, 'class')
    .replace(/^\s*export\s+(const|let|function|class)/gm, '$1')
    // a trailing `export default Foo;` line (component already defined above)
    .replace(/^\s*export\s+default\s+\w+\s*;?\s*$/gm, '')
    .trim()

  return stubs.length ? [...stubs, stripped].join('\n') : stripped
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
