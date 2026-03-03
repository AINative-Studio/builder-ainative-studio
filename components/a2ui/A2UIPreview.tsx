'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { ComponentMapper, A2UIComponent } from './ComponentMapper'
import {
  useAgentConnection,
  AgentConnectionStatus,
  ConnectionStatus,
  A2UIMessage,
} from './AgentConnection'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw, Play, Square, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A2UI Preview Configuration
 */
export interface A2UIPreviewProps {
  chatId: string
  agentUrl?: string
  className?: string
  autoConnect?: boolean
  showControls?: boolean
  showStatus?: boolean
  enableVideo?: boolean
  onComponentRender?: (component: A2UIComponent) => void
  onAction?: (action: string, context: any) => void
  onError?: (error: Error) => void
}

/**
 * A2UIPreview
 * Main component for rendering agent-controlled dynamic UI
 *
 * Features:
 * - WebSocket connection to agent
 * - Real-time component updates
 * - Interactive previews (buttons, forms work)
 * - Video integration support
 * - Agent-controlled layout
 */
export function A2UIPreview({
  chatId,
  agentUrl = process.env.NEXT_PUBLIC_A2UI_AGENT_URL || '/api/a2ui',
  className,
  autoConnect = true,
  showControls = true,
  showStatus = true,
  enableVideo = true,
  onComponentRender,
  onAction,
  onError,
}: A2UIPreviewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [messageHistory, setMessageHistory] = useState<A2UIMessage[]>([])

  // Build WebSocket URL
  const wsUrl = agentUrl.includes('://')
    ? agentUrl
    : `${typeof window !== 'undefined' ? window.location.origin : ''}${agentUrl}`

  // Connect to agent
  const {
    status,
    component,
    error,
    connect,
    disconnect,
    sendAction,
    isConnected,
  } = useAgentConnection({
    url: wsUrl,
    chatId,
    reconnect: true,
    reconnectInterval: 3000,
    maxReconnectAttempts: 5,
    onMessage: (message) => {
      setMessageHistory((prev) => [...prev, message])
      if (message.type === 'render') {
        onComponentRender?.(message.payload.component)
      }
    },
    onError,
  })

  // Handle user actions
  const handleAction = useCallback(
    (action: string, context: any) => {
      if (isPaused) {
        console.log('[A2UI] Actions paused')
        return
      }

      console.log('[A2UI] Action triggered:', action, context)
      sendAction(action, context)
      onAction?.(action, context)
    },
    [sendAction, onAction, isPaused]
  )

  // Refresh preview
  const handleRefresh = useCallback(() => {
    disconnect()
    setTimeout(() => {
      connect()
    }, 100)
  }, [connect, disconnect])

  // Toggle pause
  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => !prev)
  }, [])

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect && !isConnected && status === ConnectionStatus.DISCONNECTED) {
      connect()
    }
  }, [autoConnect, isConnected, status, connect])

  return (
    <div
      className={cn(
        'flex flex-col bg-background',
        isFullscreen ? 'fixed inset-0 z-50' : 'h-full',
        className
      )}
    >
      {/* Controls Bar */}
      {showControls && (
        <div className="flex items-center justify-between gap-2 p-2 border-b bg-card">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={!isConnected}
              title="Refresh preview"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleTogglePause}
              title={isPaused ? 'Resume updates' : 'Pause updates'}
            >
              {isPaused ? (
                <Play className="w-4 h-4" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </Button>

            <div className="h-4 w-px bg-border mx-1" />

            {showStatus && (
              <AgentConnectionStatus
                status={status}
                error={error}
                onReconnect={connect}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Chat: {chatId.slice(0, 8)}...
            </span>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Preview Area */}
      <div className="flex-1 overflow-auto p-4 bg-muted/20">
        {isConnected && component ? (
          <div className="w-full h-full">
            <ComponentMapper component={component} onAction={handleAction} />
          </div>
        ) : status === ConnectionStatus.CONNECTING ||
          status === ConnectionStatus.RECONNECTING ? (
          <div className="flex items-center justify-center h-full">
            <Card className="p-8 max-w-md text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 mb-4">
                <svg
                  className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {status === ConnectionStatus.CONNECTING
                  ? 'Connecting to Agent'
                  : 'Reconnecting to Agent'}
              </h3>
              <p className="text-sm text-muted-foreground">
                Establishing real-time connection for dynamic UI updates...
              </p>
            </Card>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <Card className="p-8 max-w-md text-center border-destructive">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900 mb-4">
                <svg
                  className="w-8 h-8 text-red-600 dark:text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2 text-destructive">
                Connection Error
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {error.message}
              </p>
              <Button onClick={connect} variant="outline" size="sm">
                Try Again
              </Button>
            </Card>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Card className="p-8 max-w-md text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
                <svg
                  className="w-8 h-8 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No Preview Available</h3>
              <p className="text-sm text-muted-foreground">
                Waiting for agent to send UI components...
              </p>
              {!isConnected && status === ConnectionStatus.DISCONNECTED && (
                <Button onClick={connect} variant="outline" size="sm" className="mt-4">
                  Connect
                </Button>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Debug Info (Development Only) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="border-t p-2 bg-card text-xs font-mono">
          <div className="flex items-center gap-4">
            <span>
              Status: <strong>{status}</strong>
            </span>
            <span>
              Messages: <strong>{messageHistory.length}</strong>
            </span>
            <span>
              Component: <strong>{component?.type || 'none'}</strong>
            </span>
            <span>
              Paused: <strong>{isPaused ? 'Yes' : 'No'}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A2UI Preview with fallback to static preview
 */
export interface A2UIPreviewWithFallbackProps extends A2UIPreviewProps {
  fallbackSrc?: string
  enableA2UI?: boolean
}

export function A2UIPreviewWithFallback({
  enableA2UI = true,
  fallbackSrc,
  ...props
}: A2UIPreviewWithFallbackProps) {
  if (!enableA2UI && fallbackSrc) {
    return (
      <div className="w-full h-full">
        <iframe
          src={fallbackSrc}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-modals"
          title="Preview"
        />
      </div>
    )
  }

  return <A2UIPreview {...props} />
}
