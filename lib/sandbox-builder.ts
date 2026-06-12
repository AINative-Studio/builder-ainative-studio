/**
 * Sandbox Builder Service
 *
 * Server-side renders React components in the AINative sandbox executor.
 * Produces self-contained HTML with Tailwind CDN.
 *
 * Approach: SSR (renderToString) → static HTML + Tailwind CDN
 * No JS bundle, no Babel, no Sandpack needed.
 */

const SANDBOX_URL = process.env.SANDBOX_EXECUTOR_URL ||
  'https://amusing-curiosity-production-9e3d.up.railway.app'

export interface BuildResult {
  success: boolean
  html: string
  buildTimeMs: number
  error?: string
}

/**
 * SSR a React component and return self-contained HTML
 */
export async function buildInSandbox(componentCode: string): Promise<BuildResult> {
  const startTime = Date.now()

  // Strip markdown wrappers
  let code = componentCode
  const codeMatch = code.match(/```(?:jsx|tsx|javascript|js|typescript)?\n([\s\S]*?)```/)
  if (codeMatch) code = codeMatch[1]

  // Detect component name before encoding
  const nameMatch = code.match(/export\s+default\s+function\s+(\w+)/)
  const compName = nameMatch ? nameMatch[1] : 'App'

  // Base64 encode component code
  const codeB64 = Buffer.from(code).toString('base64')

  const script = `
const COMP_NAME = '${compName}';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const dir = path.join(os.tmpdir(), 'ssr-' + Date.now());
fs.mkdirSync(dir, { recursive: true });

// Decode component code
const rawCode = Buffer.from('${codeB64}', 'base64').toString('utf8');

// Strip import statements (we'll provide everything via require)
let code = rawCode.replace(/^import\\s+.*from\\s+['"].*['"];?\\s*$/gm, '');

// Handle export default — convert to globalThis assignment
const nameMatch = code.match(/export\\s+default\\s+function\\s+(\\w+)/);
let compName = nameMatch ? nameMatch[1] : 'App';
code = code.replace(/export\\s+default\\s+function\\s+(\\w+)/g, 'globalThis.$1 = function $1');
code = code.replace(/export\\s+default\\s+/g, 'globalThis.__Default__ = ');

// package.json — uses esbuild-register for JSX support in Node
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
  name: 'ssr',
  dependencies: {
    'react': '^18',
    'react-dom': '^18',
    'lucide-react': '^0.400.0',
    'recharts': '^2.12.0',
    'esbuild': '^0.20.0',
    'esbuild-register': '^3.5.0',
  }
}));

// Install deps
execSync('cd ' + dir + ' && npm install --no-audit --no-fund 2>&1', { timeout: 60000 });

// SSR render script
const renderScript = \`
const React = require('react');
const { useState, useEffect, useMemo, useCallback, useRef, Fragment } = React;
const { renderToString } = require('react-dom/server');
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
\${code}

// Find and render the component
const Comp = globalThis['${compName}'] || globalThis.__Default__ || null;
if (Comp) {
  const html = renderToString(React.createElement(Comp));
  console.log(Buffer.from(html).toString('base64'));
} else {
  console.log(Buffer.from('<div style="padding:2rem;color:#999">Component not found</div>').toString('base64'));
}
\`;

fs.writeFileSync(path.join(dir, 'render.jsx'), renderScript);

try {
  // Use esbuild-register to transpile JSX at runtime
  const result = execSync('cd ' + dir + ' && node -r esbuild-register render.jsx 2>&1', { timeout: 15000 }).toString().trim();
  console.log(JSON.stringify({ ok: true, html64: result }));
} catch (e) {
  const errMsg = (e.stdout?.toString() || e.message || '').slice(-500);
  console.log(JSON.stringify({ ok: false, err: errMsg }));
}
`

  try {
    const response = await fetch(`${SANDBOX_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: script, language: 'javascript', timeout: 90 }),
      signal: AbortSignal.timeout(100_000),
    })

    if (!response.ok) {
      return { success: false, html: '', buildTimeMs: Date.now() - startTime, error: `Sandbox HTTP ${response.status}` }
    }

    const result = await response.json()
    const buildTimeMs = Date.now() - startTime

    if (!result.success) {
      return { success: false, html: '', buildTimeMs, error: result.stderr || 'Sandbox failed' }
    }

    try {
      const output = JSON.parse(result.stdout.trim())
      if (output.ok && output.html64) {
        const renderedHtml = Buffer.from(output.html64, 'base64').toString('utf8')

        // Wrap in full HTML page with Tailwind CDN
        const fullHtml = `<!DOCTYPE html>
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

        console.log(`[Sandbox] SSR success: ${renderedHtml.length} bytes rendered, ${fullHtml.length} bytes total, ${buildTimeMs}ms`)
        return { success: true, html: fullHtml, buildTimeMs }
      }
      return { success: false, html: '', buildTimeMs, error: output.err || 'SSR produced no output' }
    } catch {
      return { success: false, html: '', buildTimeMs, error: 'Failed to parse: ' + result.stdout.substring(0, 200) }
    }
  } catch (e: any) {
    return { success: false, html: '', buildTimeMs: Date.now() - startTime, error: e.message }
  }
}
