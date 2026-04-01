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

  // Ensure it has a default export
  if (mainCode && !mainCode.includes('export default')) {
    // Find the main function component name
    const match = mainCode.match(/function\s+([A-Z]\w+)/)
    if (match) {
      mainCode += `\n\nexport default ${match[1]}`
    }
  }

  // Set as /App.tsx (Sandpack's expected entry)
  sandpackFiles['/App.tsx'] = mainCode

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
