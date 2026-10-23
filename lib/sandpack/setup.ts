/**
 * Sandpack setup configuration
 * Combines AIKit, shadcn, and template files into a complete sandbox config.
 */

import { aikitFiles } from './aikit-bundle'
import { shadcnFiles } from './shadcn-bundle'

/**
 * External resources loaded via CDN (Tailwind JIT). Kept for backward
 * compatibility / any other caller that still reads this constant, but the
 * REAL preview path (components/chat/sandpack-preview.tsx) no longer passes
 * this to Sandpack's `externalResources` option — see the /public/index.html
 * doc comment below for why.
 */
export const sandpackExternalResources = [
  'https://cdn.tailwindcss.com',
]

/** Base template files every sandbox gets */
export const templateFiles: Record<string, string> = {
  /**
   * Found live (2026-10-19): 9 of 23 real companies' /build/{slug} previews
   * rendered with zero CSS applied — real content, real Tailwind classNames
   * in the DOM, just unstyled. Root cause: Tailwind's CDN script was loaded
   * via Sandpack's `externalResources` option, which injects it as an async
   * <script> tag AFTER the bundler's own HTML shell has already loaded —
   * racing against React's render. Tailwind's CDN script only scans the DOM
   * for classes once it finishes loading+initializing; if React mounts
   * first (common on the self-hosted bundler, which is slower/less cached
   * than stock CodeSandbox's CDN), the scan either never happens or happens
   * before the real classes exist, and Sandpack's own "done" event fires
   * from React's mount — genuinely unaware the stylesheet never applied.
   *
   * Fix: load the script directly in THIS static HTML shell, as the very
   * first thing in <head>, with no `async`/`defer` — a plain blocking
   * <script src>, which the browser fetches and executes before parsing
   * continues to <body>/mounting React at all. This is deterministically
   * loaded before any Sandpack-side JS runs (it's the shell every preview
   * starts from), closing the race at its root instead of trying to detect
   * or retry around it after the fact.
   */
  /**
   * #root starts hidden (opacity:0) rather than displaying unstyled content
   * — see /src/index.tsx below for why `window.tailwind` existing is NOT
   * enough to know styling is actually applied, and why the real fix reveals
   * #root only once Tailwind's injected <style> tag is confirmed present.
   */
  /**
   * ROOT CAUSE FOUND (2026-10-19/20, #1129/#1130), after cloning the real
   * AINative-Studio/sandpack-bundler source: its replaceHTML() (src/utils/
   * html.ts) parses this file into { head, body } via getHTMLParts(), but
   * then ONLY ever applies `document.body.innerHTML = body` -- the comment
   * directly above it reads "// We only replace the body for now". <head>
   * content is therefore never applied at all. But moving the Tailwind
   * <script> into <body> (#1129) ALSO didn't fix it, still live-confirmed
   * `window.tailwind === undefined` afterward -- because `el.innerHTML =
   * htmlString` is a standard, spec-defined DOM behavior: <script> tags
   * parsed out of an innerHTML assignment are inert and NEVER execute, in
   * any browser, regardless of where in the string they appear. This
   * bundler's replaceHTML() has no code that extracts and re-creates those
   * script nodes to make them live (the standard workaround for this exact
   * browser quirk) -- so NO <script> tag in this HTML file, head or body,
   * has ever executed via this mechanism. The only part of this file that
   * does anything useful is non-script content (meta/link/title degrade
   * gracefully if ignored) and the #root div, which IS correctly placed
   * into the live DOM by the innerHTML assignment itself (just inert, not
   * absent).
   *
   * Real fix (#1130): stop trying to run anything via this file's own
   * <script> tags at all. Load Tailwind instead from inside /index.tsx
   * (below) -- a real ES module the bundler's own module system compiles
   * and executes directly, an entirely different code path from this
   * dead HTML-string replacement, already proven live to execute
   * correctly (its own diagnostic logging has reliably fired every time).
   * document.createElement('script') + appendChild from WITHIN that module
   * is standard, live DOM scripting -- not subject to the innerHTML-inert-
   * script limitation at all, since the element is attached directly via
   * the DOM API, never parsed from an HTML string.
   */
  '/public/index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <title>AINative Preview</title>
</head>
<body style="font-family: Inter, system-ui, sans-serif; margin: 0;">
  <div id="root" style="opacity: 0;"></div>
</body>
</html>`,

  /**
   * Found live (2026-10-19): 9 of 23 real companies' /build/{slug} previews
   * rendered with zero CSS applied — real content, real Tailwind classNames
   * in the DOM, just unstyled. Root cause (full investigation, two layers):
   *
   *   1. Tailwind's CDN script was loaded via Sandpack's `externalResources`
   *      option, injecting it as an async <script> AFTER the bundler's HTML
   *      shell had already loaded — racing against React's render. Fixed by
   *      moving it into THIS file's /public/index.html as a plain blocking
   *      <script src>, the very first thing in <head> (no async/defer).
   *
   *   2. Even with that fix, a real gap remained: Tailwind's CDN script sets
   *      `window.tailwind` SYNCHRONOUSLY the instant it loads, but the actual
   *      CSS generation — scanning the DOM for classes, compiling via
   *      PostCSS, injecting a real <style> tag into <head> — happens
   *      ASYNCHRONOUSLY afterward, via a MutationObserver that only has
   *      something to scan once React has mounted. So `window.tailwind`
   *      existing proves the SCRIPT loaded, not that styling has been
   *      APPLIED — confirmed live: the first fix alone did not resolve the
   *      bug, still reproduced exactly the same way after deploying it.
   *
   * Real fix: #root starts hidden (opacity:0 in the HTML above). Mount React
   * immediately — Tailwind's observer needs real DOM content to scan, so
   * delaying the mount only delays the scan too. Then poll for the actual
   * signal that styling has been applied: a real <style> element appended to
   * <head> with non-empty textContent (exactly what Tailwind's CDN script's
   * internal compile step does once it resolves — see its source: it creates
   * one `<style>` tag and sets its textContent to the compiled CSS). Only
   * once that's confirmed does #root become visible, so a visitor never sees
   * the unstyled flash regardless of whether Sandpack's own "done" event
   * fired first. Bounded to 3s so a genuinely blocked/offline Tailwind
   * script still reveals the (unstyled) content — unstyled is strictly
   * better than permanently invisible.
   *
   * WRONG PATH, FOUND LIVE (2026-10-19): this override originally lived at
   * '/src/index.tsx'. Sandpack's own `react-ts` template (customSetup is
   * react-ts in components/chat/sandpack-preview.tsx) ships its OWN default
   * entry at ROOT '/index.tsx' (package.json main: "/index.tsx", with no
   * Tailwind-wait logic at all — createRoot().render(<App/>) directly) —
   * confirmed by reading the template source in
   * @codesandbox/sandpack-react's REACT_TYPESCRIPT_TEMPLATE. A file map key
   * only OVERRIDES the template file at the SAME path; '/src/index.tsx' and
   * '/index.tsx' are different files, so the real entry point Sandpack
   * actually boots from was never touched by this fix — the stock,
   * wait-nothing version kept running on every real Sandpack preview the
   * whole time. Confirmed live: wrench stayed blank 30+ seconds (past even
   * Sandpack's own 15s watchdog) after this was believed fixed. The key
   * MUST be '/index.tsx' (root), matching the template's real path exactly.
   */
  '/index.tsx': `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

window.addEventListener('unhandledrejection', function(e) {
  if (e.reason && e.reason.toString().includes('read only property')) {
    e.preventDefault()
  }
})
window.addEventListener('error', function(e) {
  if (e.message && e.message.includes('read only property')) {
    e.preventDefault()
  }
})

const root = createRoot(document.getElementById('root')!)
root.render(<App />)

const _twScript = document.createElement('script')
_twScript.src = 'https://cdn.tailwindcss.com'
_twScript.onload = function () {
  document.documentElement.classList.add('tw-scan-nudge')
  document.documentElement.classList.remove('tw-scan-nudge')
}
document.head.appendChild(_twScript)

function tailwindStyleInjected(): boolean {
  return Array.from(document.head.querySelectorAll('style')).some(
    (el) => (el.textContent || '').length > 0
  )
}

function revealOnceStyled(deadline: number) {
  const el = document.getElementById('root')!
  if (tailwindStyleInjected() || Date.now() >= deadline) {
    el.style.opacity = '1'
    return
  }
  setTimeout(() => revealOnceStyled(deadline), 30)
}

// Content-scaled bound, not a fixed guess: found live (2026-10-20) that even
// 15s wasn't enough for vaultn, whose generation produced a single 30KB/
// 614-line App.tsx with no separate component files (vs. a properly
// decomposed app's several smaller files) — Tailwind's JIT compile genuinely
// takes longer to scan+process that much JSX in one pass, it isn't hung. A
// fixed bound forces a choice between making every small app wait
// unnecessarily long or leaving large ones revealed-but-unstyled. Instead,
// scale the bound to how much source Sandpack actually has to compile:
// window.__APP_SOURCE_CHARS__ is set by buildSandpackFiles() (lib/sandpack/
// build-files.ts) to the real assembled /App.tsx length. Base 8s covers a
// typical small app; +1s per 3,000 chars covers larger ones (vaultn's
// ~30,000 chars → +10s ≈ 18s total), capped at 30s so a genuinely stuck
// compile still reveals (unstyled) content in a bounded time.
const _appChars = (window as any).__APP_SOURCE_CHARS__ || 0
const _boundMs = Math.min(30000, 8000 + Math.floor(_appChars / 3000) * 1000)
revealOnceStyled(Date.now() + _boundMs)
`,

  '/src/styles/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: Inter, system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
`,

  '/tsconfig.json': `{
  "compilerOptions": {
    "target": "es2020",
    "module": "esnext",
    "jsx": "react-jsx",
    "strict": false,
    "esModuleInterop": true,
    "moduleResolution": "node",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}`,
}

/**
 * Get all built-in files for a Sandpack sandbox.
 * Duplicates files at both /src/ and root / paths so any import style works.
 */
export function getBuiltinFiles(): Record<string, string> {
  const files: Record<string, string> = {
    ...templateFiles,
    ...shadcnFiles,
    ...aikitFiles,
  }

  // Duplicate /src/components/* to /components/* so both import paths work:
  // import { Button } from './components/ui/button'  (from /App.tsx)
  // import { Button } from '../components/ui/button' (from /src/*)
  // import { Button } from '@/components/ui/button'  (alias — not supported in Sandpack)
  const dupes: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith('/src/components/')) {
      const rootPath = path.replace('/src/components/', '/components/')
      dupes[rootPath] = content
    }
    if (path.startsWith('/src/lib/')) {
      const rootPath = path.replace('/src/lib/', '/lib/')
      dupes[rootPath] = content
    }
  }

  return { ...files, ...dupes }
}

/**
 * Merge generated files with built-in files.
 * Generated files take precedence over built-ins.
 */
export function buildSandpackFiles(generatedFiles: Record<string, string>): Record<string, string> {
  const builtins = getBuiltinFiles()
  return {
    ...builtins,
    ...generatedFiles,
  }
}
