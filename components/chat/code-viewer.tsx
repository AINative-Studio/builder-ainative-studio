import React, { useState } from 'react'
import { X, Code, Copy, Check, Download, Maximize2, Minimize2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CodeViewerProps {
  isOpen: boolean
  onClose: () => void
  chatId: string | null
}

// Project file structure type
interface ProjectFile {
  name: string
  path: string
  content: string
  language: string
}

export function CodeViewer({ isOpen, onClose, chatId }: CodeViewerProps) {
  const [code, setCode] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([])
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null)

  // Fetch code when viewer opens
  React.useEffect(() => {
    if (isOpen && chatId) {
      setLoading(true)
      fetch(`/api/chats/${chatId}/code`)
        .then(res => res.json())
        .then(data => {
          const mainCode = data.code || 'No code available'
          setCode(mainCode)

          // Generate project files from the main component
          const files = generateProjectFiles(mainCode)
          setProjectFiles(files)

          // Select the main component file by default
          const mainFile = files.find(f => f.name === 'Component.jsx') || files[0]
          setSelectedFile(mainFile || null)

          setLoading(false)
        })
        .catch(error => {
          console.error('Error fetching code:', error)
          setCode('Error loading code')
          setLoading(false)
        })
    }
  }, [isOpen, chatId])

  // Generate complete project structure from main component
  const generateProjectFiles = (mainCode: string): ProjectFile[] => {
    const files: ProjectFile[] = []

    // Main component file
    files.push({
      name: 'Component.jsx',
      path: 'src/Component.jsx',
      content: mainCode,
      language: 'jsx'
    })

    // package.json
    files.push({
      name: 'package.json',
      path: 'package.json',
      content: JSON.stringify({
        name: 'generated-component',
        version: '1.0.0',
        private: true,
        dependencies: {
          'react': '^18.2.0',
          'react-dom': '^18.2.0',
          'lucide-react': '^0.263.1'
        },
        devDependencies: {
          '@types/react': '^18.2.0',
          '@types/react-dom': '^18.2.0',
          'typescript': '^5.0.0',
          'tailwindcss': '^3.3.0'
        },
        scripts: {
          'dev': 'vite',
          'build': 'vite build',
          'preview': 'vite preview'
        }
      }, null, 2),
      language: 'json'
    })

    // tsconfig.json
    files.push({
      name: 'tsconfig.json',
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true
        },
        include: ['src'],
        references: [{ path: './tsconfig.node.json' }]
      }, null, 2),
      language: 'json'
    })

    // App.tsx (entry point)
    files.push({
      name: 'App.tsx',
      path: 'src/App.tsx',
      content: `import Component from './Component'\n\nfunction App() {\n  return <Component />\n}\n\nexport default App`,
      language: 'tsx'
    })

    // main.tsx
    files.push({
      name: 'main.tsx',
      path: 'src/main.tsx',
      content: `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App'\nimport './index.css'\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n)`,
      language: 'tsx'
    })

    // globals.css
    files.push({
      name: 'index.css',
      path: 'src/index.css',
      content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n:root {\n  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;\n  line-height: 1.5;\n  font-weight: 400;\n}\n\nbody {\n  margin: 0;\n  min-width: 320px;\n  min-height: 100vh;\n}`,
      language: 'css'
    })

    // tailwind.config.js
    files.push({
      name: 'tailwind.config.js',
      path: 'tailwind.config.js',
      content: `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}`,
      language: 'javascript'
    })

    // index.html
    files.push({
      name: 'index.html',
      path: 'index.html',
      content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Generated Component</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>`,
      language: 'html'
    })

    return files
  }

  const handleCopy = async () => {
    const contentToCopy = selectedFile?.content || code
    await navigator.clipboard.writeText(contentToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const contentToDownload = selectedFile?.content || code
    const fileName = selectedFile?.name || 'component.jsx'
    const blob = new Blob([contentToDownload], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleDownloadAll = () => {
    // Create a zip-like structure by downloading all files
    // For now, we'll create a simple text file with all project files
    const allFilesContent = projectFiles
      .map(file => `// ${file.path}\n${file.content}\n\n`)
      .join('\n' + '='.repeat(80) + '\n\n')

    const blob = new Blob([allFilesContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'project-files.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!isOpen) return null

  return (
    <div className={`flex flex-col bg-white dark:bg-gray-900 ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center gap-3">
            {!isFullscreen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="mr-2"
                title="Back to preview"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Preview
              </Button>
            )}
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Code className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Generated Code
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                View and copy your component code
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              disabled={loading || !code}
              title="Download code"
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              disabled={loading || !code}
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              title="Close"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full flex">
            {/* File Tree with all project files */}
            <div className="w-64 border-r border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800 overflow-y-auto">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">
                Project Files ({projectFiles.length})
              </div>
              <div className="space-y-1">
                {projectFiles.map((file) => {
                  const isSelected = selectedFile?.path === file.path
                  const getFileIcon = (name: string) => {
                    if (name.endsWith('.json')) return '📋'
                    if (name.endsWith('.tsx') || name.endsWith('.ts')) return '🔷'
                    if (name.endsWith('.jsx') || name.endsWith('.js')) return '📜'
                    if (name.endsWith('.css')) return '🎨'
                    if (name.endsWith('.html')) return '🌐'
                    return '📄'
                  }

                  return (
                    <button
                      key={file.path}
                      onClick={() => setSelectedFile(file)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="text-base">{getFileIcon(file.name)}</span>
                      <span className={`text-sm font-medium truncate ${
                        isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                      }`}>
                        {file.name}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Code Display with Line Numbers */}
            <div className="flex-1 overflow-auto bg-[#1e1e1e] dark:bg-[#1e1e1e]">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    <div className="text-gray-400">Loading code...</div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full">
                  {/* Line numbers */}
                  <div className="flex-shrink-0 bg-[#1e1e1e] border-r border-gray-700 px-4 py-6 select-none">
                    {(selectedFile?.content || code).split('\n').map((_, i) => (
                      <div
                        key={i}
                        className="text-gray-500 text-sm font-mono leading-relaxed text-right"
                      >
                        {i + 1}
                      </div>
                    ))}
                  </div>
                  {/* Code content */}
                  <pre className="flex-1 p-6 text-sm font-mono leading-relaxed overflow-x-auto">
                    <code className="text-gray-100">{selectedFile?.content || code}</code>
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer - IDE Status Bar */}
        <div className="border-t border-gray-700 px-6 py-2 bg-[#007acc] text-white text-xs flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Code className="w-3 h-3" />
              <span className="font-medium">
                {selectedFile?.language.toUpperCase() || 'JavaScript (JSX)'}
              </span>
            </div>
            <div className="text-white/80">
              {selectedFile ? selectedFile.name : 'Component.jsx'}
            </div>
            <div className="text-white/80">
              {(selectedFile?.content || code) ? `${(selectedFile?.content || code).split('\n').length} lines` : 'No code loaded'}
            </div>
            <div className="text-white/80">
              {(selectedFile?.content || code) ? `${new Blob([selectedFile?.content || code]).size} bytes` : ''}
            </div>
          </div>
          <div className="flex items-center gap-4 text-white/80">
            <span>UTF-8</span>
            <span>LF</span>
            <span>Spaces: 2</span>
          </div>
        </div>
    </div>
  )
}
