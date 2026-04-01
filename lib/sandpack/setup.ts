/**
 * Sandpack setup configuration
 * Combines AIKit, shadcn, and template files into a complete sandbox config.
 */

import { aikitFiles } from './aikit-bundle'
import { shadcnFiles } from './shadcn-bundle'

/** Dependencies available in every Sandpack sandbox */
export const sandpackDependencies: Record<string, string> = {
  'lucide-react': 'latest',
  recharts: '2.15.0',
  clsx: 'latest',
  'tailwind-merge': 'latest',
}

/** External resources loaded via CDN (Tailwind JIT) */
export const sandpackExternalResources = [
  'https://cdn.tailwindcss.com',
]

/** Base template files every sandbox gets */
export const templateFiles: Record<string, string> = {
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
  <div id="root"></div>
</body>
</html>`,

  '/src/index.tsx': `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
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
