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
  // Ensure we have an entry point
  const sandpackFiles: Record<string, string> = { ...files }

  // If no /App.tsx or /src/app/page.tsx, create a wrapper
  if (!sandpackFiles['/App.tsx'] && !sandpackFiles['/src/app/page.tsx']) {
    // Find the main component file
    const mainFile = Object.keys(sandpackFiles).find(
      (f) => f.endsWith('page.tsx') || f.endsWith('App.tsx') || f.endsWith('index.tsx')
    )
    if (mainFile && !sandpackFiles['/App.tsx']) {
      sandpackFiles['/App.tsx'] = sandpackFiles[mainFile]
    }
  }

  return (
    <div className={cn('w-full h-full', className)}>
      <SandpackProvider
        template="react-ts"
        files={sandpackFiles}
        customSetup={{
          dependencies: {
            'lucide-react': 'latest',
            recharts: '2.15.0',
            clsx: 'latest',
            'tailwind-merge': 'latest',
          },
        }}
        options={{
          externalResources: ['https://cdn.tailwindcss.com'],
          classes: {
            'sp-wrapper': 'h-full',
            'sp-layout': 'h-full',
            'sp-preview': 'h-full',
          },
        }}
        theme={theme === 'dark' ? 'dark' : 'light'}
      >
        <SandpackLayout style={{ height: '100%', border: 'none' }}>
          <SandpackPreviewComponent
            showNavigator={false}
            showRefreshButton={false}
            style={{ height: '100%' }}
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  )
}
