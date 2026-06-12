/**
 * Sandbox Builder Service
 *
 * Builds generated React code in the AINative sandbox executor,
 * producing static HTML/CSS/JS that can be served directly.
 * No CDN scripts, no Babel compilation, no Sandpack needed.
 *
 * Architecture: Generate → Sandbox Build → Serve Static Output
 */

const SANDBOX_URL = process.env.SANDBOX_EXECUTOR_URL ||
  'https://amusing-curiosity-production-9e3d.up.railway.app'

interface BuildResult {
  success: boolean
  html: string
  buildTimeMs: number
  error?: string
}

/**
 * Build a React component in the sandbox and return self-contained HTML
 */
export async function buildInSandbox(componentCode: string): Promise<BuildResult> {
  const startTime = Date.now()

  // Strip markdown wrappers
  let code = componentCode
  const codeMatch = code.match(/```(?:jsx|tsx|javascript|js)?\n([\s\S]*?)```/)
  if (codeMatch) code = codeMatch[1]

  // Encode the component code as base64 to avoid escaping issues
  const codeBase64 = Buffer.from(code).toString('base64')

  // The build script: creates a Vite project, writes the component, builds, and returns the output
  const buildScript = `
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const dir = path.join(os.tmpdir(), 'build-' + Date.now());
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

// package.json
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
  name: 'preview-app',
  private: true,
  type: 'module',
  scripts: { build: 'vite build' },
  dependencies: {
    'react': '^18',
    'react-dom': '^18',
    'lucide-react': '^0.400.0',
    'recharts': '^2.12.0',
  },
  devDependencies: {
    '@vitejs/plugin-react': '^4',
    'vite': '^5',
    'tailwindcss': '^3',
    'postcss': '^8',
    'autoprefixer': '^10',
  }
}));

// vite.config.js
fs.writeFileSync(path.join(dir, 'vite.config.js'), \`
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  build: { assetsInlineLimit: 100000 },
  resolve: {
    alias: { '@/components/ui': '/src/ui', '@/components/aikit': '/src/aikit' }
  }
})
\`);

// tailwind.config.js
fs.writeFileSync(path.join(dir, 'tailwind.config.js'), \`
export default { content: ['./index.html', './src/**/*.{js,jsx}'], theme: { extend: {} }, plugins: [] }
\`);

// postcss.config.js
fs.writeFileSync(path.join(dir, 'postcss.config.js'), \`
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
\`);

// index.html
fs.writeFileSync(path.join(dir, 'index.html'), \`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Preview</title></head>
<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>\`);

// globals.css with Tailwind
fs.writeFileSync(path.join(dir, 'src/index.css'), '@tailwind base;\\n@tailwind components;\\n@tailwind utilities;');

// Stub shadcn/ui components
fs.mkdirSync(path.join(dir, 'src/ui'), { recursive: true });
fs.writeFileSync(path.join(dir, 'src/ui/button.jsx'), 'import React from "react"; export const Button = ({children, className="", ...p}) => React.createElement("button", {className: "px-4 py-2 rounded-lg font-medium " + className, ...p}, children);');
fs.writeFileSync(path.join(dir, 'src/ui/card.jsx'), 'import React from "react"; export const Card = ({children, className="", ...p}) => React.createElement("div", {className: "bg-white rounded-xl border shadow-sm " + className, ...p}, children); export const CardHeader = ({children, className="", ...p}) => React.createElement("div", {className: "p-6 pb-2 " + className, ...p}, children); export const CardTitle = ({children, className="", ...p}) => React.createElement("h3", {className: "font-semibold text-lg " + className, ...p}, children); export const CardDescription = ({children, className="", ...p}) => React.createElement("p", {className: "text-sm text-gray-500 " + className, ...p}, children); export const CardContent = ({children, className="", ...p}) => React.createElement("div", {className: "p-6 pt-2 " + className, ...p}, children); export const CardFooter = ({children, className="", ...p}) => React.createElement("div", {className: "p-6 pt-2 " + className, ...p}, children);');
fs.writeFileSync(path.join(dir, 'src/ui/badge.jsx'), 'import React from "react"; export const Badge = ({children, className="", variant="default", ...p}) => React.createElement("span", {className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium " + (variant === "destructive" ? "bg-red-100 text-red-700" : variant === "secondary" ? "bg-gray-100 text-gray-700" : "bg-blue-100 text-blue-700") + " " + className, ...p}, children);');
fs.writeFileSync(path.join(dir, 'src/ui/input.jsx'), 'import React from "react"; export const Input = ({className="", ...p}) => React.createElement("input", {className: "border rounded-lg px-3 py-2 text-sm w-full " + className, ...p}); export const Label = ({children, className="", ...p}) => React.createElement("label", {className: "text-sm font-medium " + className, ...p}, children);');
fs.writeFileSync(path.join(dir, 'src/ui/tabs.jsx'), 'import React, {useState} from "react"; export const Tabs = ({children, defaultValue, className=""}) => { const [val, setVal] = useState(defaultValue); return React.createElement("div", {className}, React.Children.map(children, c => c && React.cloneElement(c, {value: val, onValueChange: setVal}))); }; export const TabsList = ({children, className="",...p}) => React.createElement("div", {className: "flex gap-1 bg-gray-100 p-1 rounded-lg " + className, ...p}, children); export const TabsTrigger = ({children, value, onValueChange, className=""}) => React.createElement("button", {className: "px-3 py-1.5 text-sm rounded-md " + className, onClick: () => onValueChange?.(value)}, children); export const TabsContent = ({children, value: current, className=""}) => React.createElement("div", {className}, children);');

// Stub aikit
fs.mkdirSync(path.join(dir, 'src/aikit'), { recursive: true });
fs.writeFileSync(path.join(dir, 'src/aikit/index.jsx'), 'import React from "react"; export const MetricCard = ({title, value, change, changeType, icon: Icon, className=""}) => React.createElement("div", {className: "bg-white rounded-xl border p-6 " + className}, React.createElement("div", {className: "flex justify-between items-start"}, React.createElement("div", null, React.createElement("p", {className: "text-sm text-gray-500"}, title), React.createElement("p", {className: "text-2xl font-bold mt-1"}, value), change && React.createElement("span", {className: "text-sm " + (changeType === "positive" ? "text-green-600" : changeType === "negative" ? "text-red-600" : "text-gray-500")}, change)), Icon && React.createElement(Icon, {className: "w-5 h-5 text-gray-400"})));');

// Component code (base64 decoded to avoid escaping issues)
const componentCode = Buffer.from('${codeBase64}', 'base64').toString('utf8');

// Main entry point
const mainCode = \`
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

\${componentCode.replace(/export\\s+default\\s+/g, 'const __App__ = ')}

// Find the main component
const App = typeof __App__ !== 'undefined' ? __App__ :
  (() => { const names = Object.keys(globalThis).filter(k => typeof globalThis[k] === 'function' && /^[A-Z]/.test(k)); return names.length > 0 ? globalThis[names[names.length-1]] : () => React.createElement('div', null, 'No component found'); })();

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App))
\`;
fs.writeFileSync(path.join(dir, 'src/main.jsx'), mainCode);

try {
  execSync('cd ' + dir + ' && npm install --no-audit --no-fund --prefer-offline 2>&1', { timeout: 60000 });
  execSync('cd ' + dir + ' && npx vite build --minify 2>&1', { timeout: 30000 });

  // Read built files
  const html = fs.readFileSync(path.join(dir, 'dist/index.html'), 'utf8');
  const assetsDir = path.join(dir, 'dist/assets');
  const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];

  // Inline JS and CSS into the HTML for single-file output
  let inlinedHtml = html;
  for (const asset of assets) {
    const assetPath = path.join(assetsDir, asset);
    const content = fs.readFileSync(assetPath, 'utf8');
    if (asset.endsWith('.js')) {
      inlinedHtml = inlinedHtml.replace(
        new RegExp('<script[^>]*src="/assets/' + asset.replace('.', '\\\\.') + '"[^>]*></script>'),
        '<script type="module">' + content + '</script>'
      );
    }
    if (asset.endsWith('.css')) {
      inlinedHtml = inlinedHtml.replace(
        new RegExp('<link[^>]*href="/assets/' + asset.replace('.', '\\\\.') + '"[^>]*>'),
        '<style>' + content + '</style>'
      );
    }
  }

  console.log(JSON.stringify({ success: true, html: inlinedHtml, assets: assets.length }));
} catch (e) {
  console.log(JSON.stringify({ success: false, error: e.stdout?.toString().slice(-500) || e.message }));
}
`

  try {
    const response = await fetch(`${SANDBOX_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: buildScript,
        language: 'javascript',
        timeout: 90,
      }),
      signal: AbortSignal.timeout(100_000),
    })

    if (!response.ok) {
      return { success: false, html: '', buildTimeMs: Date.now() - startTime, error: `Sandbox HTTP ${response.status}` }
    }

    const result = await response.json()
    const buildTimeMs = Date.now() - startTime

    if (!result.success) {
      return { success: false, html: '', buildTimeMs, error: result.stderr || 'Build failed' }
    }

    // Parse the JSON output from stdout
    try {
      const output = JSON.parse(result.stdout.trim())
      if (output.success && output.html) {
        return { success: true, html: output.html, buildTimeMs }
      }
      return { success: false, html: '', buildTimeMs, error: output.error || 'No HTML output' }
    } catch {
      return { success: false, html: '', buildTimeMs, error: 'Failed to parse build output' }
    }
  } catch (e: any) {
    return { success: false, html: '', buildTimeMs: Date.now() - startTime, error: e.message }
  }
}
