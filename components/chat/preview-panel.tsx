import React, { useState, lazy, Suspense } from 'react'
import {
  WebPreview,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  WebPreviewBody,
} from '@/components/ai-elements/web-preview'
import { RefreshCw, Monitor, Maximize, Minimize, Download, Rocket, Code, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ExportButton } from '@/components/export-button'
import { DeployDialog } from '@/components/deploy-dialog'
import { Button } from '@/components/ui/button'
import { CodeViewer } from '@/components/chat/code-viewer'
import { A2UIPreviewWithFallback } from '@/components/a2ui'

const SandpackPreviewLazy = lazy(() => import('@/components/chat/sandpack-preview').then(m => ({ default: m.SandpackPreview })))

interface Chat {
  id: string
  demo?: string
  url?: string
}

interface PreviewPanelProps {
  currentChat: Chat | null
  isFullscreen: boolean
  setIsFullscreen: (fullscreen: boolean) => void
  refreshKey: number
  setRefreshKey: (key: number | ((prev: number) => number)) => void
  isGenerating?: boolean
  buildSteps?: string[]
  sandpackFiles?: Record<string, string> | null
}

export function PreviewPanel({
  currentChat,
  isFullscreen,
  setIsFullscreen,
  refreshKey,
  setRefreshKey,
  isGenerating = false,
  buildSteps = [],
  sandpackFiles,
}: PreviewPanelProps) {
  const [showDeployDialog, setShowDeployDialog] = useState(false)
  const [showCodeViewer, setShowCodeViewer] = useState(false)
  const [progress, setProgress] = useState(0)
  const [useA2UI, setUseA2UI] = useState(false)
  const useSandpack = !!sandpackFiles && Object.keys(sandpackFiles).length > 0


  // Simulate progress based on build steps
  React.useEffect(() => {
    if (isGenerating && buildSteps.length > 0) {
      const progressPerStep = 100 / buildSteps.length
      setProgress(Math.min((buildSteps.length * progressPerStep), 95))
    } else if (!isGenerating) {
      setProgress(100)
      // Reset progress after a short delay
      setTimeout(() => setProgress(0), 1000)
    }
  }, [isGenerating, buildSteps.length])

  return (
    <div
      className={cn(
        'flex flex-col transition-all duration-300',
        isFullscreen ? 'fixed inset-0 z-50 bg-white dark:bg-black h-screen' : 'flex-1 h-full min-h-0',
      )}
    >
      <WebPreview
        defaultUrl={currentChat?.demo || ''}
        onUrlChange={(url) => {
          // Optional: Handle URL changes if needed
          console.log('Preview URL changed:', url)
        }}
      >
        <WebPreviewNavigation>
          <WebPreviewNavigationButton
            onClick={() => {
              // Force refresh the iframe by updating the refresh key
              setRefreshKey((prev) => prev + 1)
            }}
            tooltip="Refresh preview"
            disabled={!currentChat?.demo}
          >
            <RefreshCw className="h-4 w-4" />
          </WebPreviewNavigationButton>

          <WebPreviewNavigationButton
            onClick={() => setShowCodeViewer(true)}
            tooltip="View generated code"
            disabled={!currentChat?.id}
          >
            <Code className="h-4 w-4" />
          </WebPreviewNavigationButton>

          <WebPreviewNavigationButton
            onClick={() => setUseA2UI(!useA2UI)}
            tooltip={useA2UI ? 'Switch to static preview' : 'Enable A2UI dynamic preview'}
            disabled={!currentChat?.id}
          >
            <Zap className={cn('h-4 w-4', useA2UI && 'text-blue-600')} />
          </WebPreviewNavigationButton>

          <WebPreviewUrl
            readOnly
            placeholder="Your app will appear here..."
            value={currentChat?.demo || ''}
          />

          {/* Export and Deploy buttons */}
          <div className="flex items-center gap-2">
            {currentChat?.id && (
              <>
                <ExportButton
                  generationId={currentChat.id}
                  variant="ghost"
                  size="sm"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDeployDialog(true)}
                >
                  <Rocket className="w-4 h-4 mr-2" />
                  Deploy
                </Button>
              </>
            )}
          </div>

          <WebPreviewNavigationButton
            onClick={() => setIsFullscreen(!isFullscreen)}
            tooltip={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            disabled={!currentChat?.demo}
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </WebPreviewNavigationButton>
        </WebPreviewNavigation>
        {currentChat?.demo || useSandpack ? (
          <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
            {/* Show Code Viewer inline when code button clicked */}
            {showCodeViewer ? (
              <CodeViewer
                isOpen={showCodeViewer}
                onClose={() => setShowCodeViewer(false)}
                chatId={currentChat?.id || null}
              />
            ) : useSandpack ? (
              /* SANDPACK FIRST — handles compilation internally, 95%+ render rate */
              <Suspense fallback={<div className="flex-1 flex items-center justify-center"><p className="text-sm text-gray-500">Building preview...</p></div>}>
                <SandpackPreviewLazy
                  key={refreshKey}
                  files={sandpackFiles!}
                  className="w-full h-full"
                />
              </Suspense>
            ) : currentChat?.demo ? (
              /* Fallback: iframe preview for older/cached previews */
              <WebPreviewBody
                src={
                  currentChat.demo?.startsWith('/preview/')
                    ? `/api${currentChat.demo}`
                    : currentChat.demo?.startsWith('/api/preview/')
                    ? currentChat.demo
                    : currentChat.demo || ''
                }
                key={refreshKey}
              />
            ) : useA2UI && currentChat ? (
              <A2UIPreviewWithFallback
                chatId={currentChat.id}
                enableA2UI={true}
                fallbackSrc={
                  currentChat.demo?.startsWith('/preview/')
                    ? `/api${currentChat.demo}`
                    : currentChat.demo?.startsWith('/api/preview/')
                    ? currentChat.demo
                    : currentChat.demo || ''
                }
                showControls={false}
                showStatus={true}
                className="w-full h-full"
                onError={(error: any) => {
                  console.error('[PreviewPanel] A2UI Error:', error)
                  setUseA2UI(false)
                }}
              />
            ) : currentChat?.demo ? (
              <WebPreviewBody
                key={refreshKey}
                src={currentChat.demo.startsWith('/preview/')
                  ? `/api${currentChat.demo}`
                  : currentChat.demo.startsWith('/api/preview/')
                  ? currentChat.demo
                  : currentChat.demo
                }
                className="w-full h-full"
              />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-gray-500">Waiting for preview...</p>
              </div>
            )}

            {/* Subtle progress bar at top during generation — doesn't block preview */}
            {isGenerating && !showCodeViewer && (
              <div className="absolute top-0 left-0 right-0 z-50">
                <div className="h-1 bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
                  <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    {buildSteps.length > 0 ? buildSteps[buildSteps.length - 1] : 'Building your app...'}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-black">
            {isGenerating ? (
              <div className="text-center px-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 mb-3">
                  <svg className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Building your app
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {buildSteps.length > 0 ? buildSteps[buildSteps.length - 1] : 'Analyzing your requirements...'}
                </p>
                <div className="mt-3 max-w-xs mx-auto">
                  <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center px-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 mb-3">
                  <Monitor className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Your app will appear here
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Describe what you want to build and watch it come to life
                </p>
              </div>
            )}
          </div>
        )}
      </WebPreview>

      {/* Deploy Dialog */}
      {currentChat?.id && (
        <DeployDialog
          generationId={currentChat.id}
          open={showDeployDialog}
          onOpenChange={setShowDeployDialog}
        />
      )}
    </div>
  )
}
