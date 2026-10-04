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

/**
 * Detect the founder's component's name from its default export, falling
 * back to 'App'. PURE.
 */
function detectComponentName(code: string): string {
  const nameMatch = code.match(/export\s+default\s+function\s+(\w+)/)
  return nameMatch ? nameMatch[1] : 'App'
}

/**
 * Build the Node/JSX render script that SSRs the founder's component and
 * writes the resulting HTML to OUTPUT_FILE inside the sandbox. PURE (string
 * templating only — no I/O).
 */
function buildRenderScript(rawCode: string, compName: string): string {
  // Strip import statements (we provide everything via require/globals).
  let code = rawCode.replace(/^import\s+.*from\s+['"].*['"];?\s*$/gm, '')

  // Handle export default — convert to a globalThis assignment so the
  // render script below can find it without a module system.
  code = code.replace(/export\s+default\s+function\s+(\w+)/g, 'globalThis.$1 = function $1')
  code = code.replace(/export\s+default\s+/g, 'globalThis.__Default__ = ')

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

  const stripped = stripMarkdownFence(componentCode)
  const compName = detectComponentName(stripped)
  const renderScript = buildRenderScript(stripped, compName)

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
