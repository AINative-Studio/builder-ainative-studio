import React, { useState } from 'react'
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
}

export function PreviewPanel({
  currentChat,
  isFullscreen,
  setIsFullscreen,
  refreshKey,
  setRefreshKey,
  isGenerating = false,
  buildSteps = [],
}: PreviewPanelProps) {
  const [showDeployDialog, setShowDeployDialog] = useState(false)
  const [showCodeViewer, setShowCodeViewer] = useState(false)
  const [progress, setProgress] = useState(0)
  const [useA2UI, setUseA2UI] = useState(false)

  // Simulate progress based on build steps
  React.useEffect(() => {
    console.log('[PreviewPanel] isGenerating changed:', isGenerating, 'buildSteps:', buildSteps.length)
    if (isGenerating && buildSteps.length > 0) {
      const progressPerStep = 100 / buildSteps.length
      setProgress(Math.min((buildSteps.length * progressPerStep), 95))
    } else if (!isGenerating) {
      console.log('[PreviewPanel] Generation complete, setting progress to 100%')
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
        {currentChat?.demo ? (
          <div className="relative flex-1 min-h-0 overflow-hidden">
            {/* Show Code Viewer inline when code button clicked */}
            {showCodeViewer ? (
              <CodeViewer
                isOpen={showCodeViewer}
                onClose={() => setShowCodeViewer(false)}
                chatId={currentChat?.id || null}
              />
            ) : useA2UI ? (
              <A2UIPreviewWithFallback
                chatId={currentChat.id}
                enableA2UI={true}
                fallbackSrc={
                  currentChat.demo.startsWith('/preview/')
                    ? `/api${currentChat.demo}`
                    : currentChat.demo.startsWith('/api/preview/')
                    ? currentChat.demo
                    : currentChat.demo
                }
                showControls={false}
                showStatus={true}
                className="w-full h-full"
                onError={(error) => {
                  console.error('[PreviewPanel] A2UI Error:', error)
                  // Auto-fallback to static preview on error
                  setUseA2UI(false)
                }}
              />
            ) : (
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
            )}

            {/* Progress indicator overlay during generation */}
            {isGenerating && !showCodeViewer && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 max-w-md w-full mx-4">
                  <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 mb-4">
                      <svg className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      Generating your component
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {buildSteps.length > 0 ? buildSteps[buildSteps.length - 1] : 'Please wait...'}
                    </p>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                      <span>Progress</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 text-center pt-2">
                      {buildSteps.length} steps completed
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-black">
            {isGenerating ? (
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 mb-4">
                  <svg className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Generating your component
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {buildSteps.length > 0 ? buildSteps[buildSteps.length - 1] : 'Please wait...'}
                </p>
                <div className="mt-4 max-w-xs mx-auto">
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  No preview available
                </p>
                <p className="text-xs text-gray-700/50 dark:text-gray-200/50">
                  Start a conversation to see your app here
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
