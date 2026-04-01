'use client'

import {
  SandpackProvider,
  SandpackPreview as SandpackPreviewComponent,
  SandpackLayout,
} from '@codesandbox/sandpack-react'
import { cn } from '@/lib/utils'

interface SandpackPreviewProps {
  files: Record<string, string>
  theme?: 'light' | 'dark'
  className?: string
}

export function SandpackPreview({ files, theme = 'light', className }: SandpackPreviewProps) {
  const sandpackFiles: Record<string, string> = {}

  // Copy files, normalizing paths for Sandpack
  for (const [path, content] of Object.entries(files)) {
    // Skip non-code files (robots.txt, sitemap.xml, etc.)
    if (path.endsWith('.txt') || path.endsWith('.xml') || path.endsWith('.json') && path.includes('well-known')) {
      continue
    }
    sandpackFiles[path] = content
  }

  // Find the main component file
  const mainFile = Object.keys(sandpackFiles).find(
    f => f === '/src/App.tsx' || f === '/App.tsx'
  ) || Object.keys(sandpackFiles).find(
    f => f.endsWith('page.tsx') || f.endsWith('App.tsx')
  ) || Object.keys(sandpackFiles)[0]

  // Get the main component code
  let mainCode = mainFile ? sandpackFiles[mainFile] : ''

  // Inject React imports if missing — Claude often omits them
  if (mainCode && !mainCode.includes('import React')) {
    const needsHooks = /\b(useState|useEffect|useRef|useMemo|useCallback|useContext|useReducer)\b/.test(mainCode)
    const hooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer']
      .filter(h => mainCode.includes(h))
    if (needsHooks) {
      mainCode = `import React, { ${hooks.join(', ')} } from 'react'\n${mainCode}`
    } else {
      mainCode = `import React from 'react'\n${mainCode}`
    }
  }

  // Ensure it has a default export
  if (mainCode && !mainCode.includes('export default')) {
    const match = mainCode.match(/function\s+([A-Z]\w+)/)
    if (match) {
      mainCode += `\n\nexport default ${match[1]}`
    }
  }

  // Set as /App.tsx (Sandpack's expected entry)
  sandpackFiles['/App.tsx'] = mainCode

  // Also fix imports in all other component files
  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (path.endsWith('.tsx') && path !== '/App.tsx' && !code.includes('import React')) {
      const needsHooks = /\b(useState|useEffect|useRef|useMemo|useCallback)\b/.test(code)
      if (needsHooks) {
        const hooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback']
          .filter(h => code.includes(h))
        sandpackFiles[path] = `import React, { ${hooks.join(', ')} } from 'react'\n${code}`
      }
    }
  }

  return (
    <div className={cn('w-full h-full flex flex-col', className)} style={{ minHeight: 0 }}>
      <SandpackProvider
        template="react-ts"
        files={sandpackFiles}
        customSetup={{
          dependencies: {
            'lucide-react': '0.344.0',
            'recharts': '2.15.0',
            'clsx': '2.1.0',
            'tailwind-merge': '2.2.0',
          },
        }}
        options={{
          externalResources: ['https://cdn.tailwindcss.com'],
          activeFile: '/App.tsx',
        }}
        theme={theme === 'dark' ? 'dark' : 'light'}
      >
        <SandpackLayout
          style={{
            height: '100%',
            border: 'none',
            borderRadius: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SandpackPreviewComponent
            showNavigator={false}
            showRefreshButton
            showOpenInCodeSandbox={false}
            style={{ flex: 1, height: '100%' }}
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  )
}
