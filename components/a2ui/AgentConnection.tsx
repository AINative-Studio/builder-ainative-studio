'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { A2UIComponent } from './ComponentMapper'

/**
 * A2UI Protocol Message Types
 */
export interface A2UIMessage {
  type: 'render' | 'update' | 'action' | 'state' | 'error'
  payload: any
  timestamp?: number
  messageId?: string
}

export interface A2UIRenderMessage extends A2UIMessage {
  type: 'render'
  payload: {
    component: A2UIComponent
    mode?: 'replace' | 'append' | 'prepend'
  }
}

export interface A2UIUpdateMessage extends A2UIMessage {
  type: 'update'
  payload: {
    componentId: string
    updates: Partial<A2UIComponent>
  }
}

export interface A2UIActionMessage extends A2UIMessage {
  type: 'action'
  payload: {
    action: string
    context: any
  }
}

export interface A2UIStateMessage extends A2UIMessage {
  type: 'state'
  payload: {
    state: Record<string, any>
  }
}

/**
 * Connection Status
 */
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

/**
 * Agent Connection Configuration
 */
export interface AgentConnectionConfig {
  url: string
  chatId?: string
  reconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
  heartbeatInterval?: number
  onMessage?: (message: A2UIMessage) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Error) => void
}

/**
 * Agent Connection Hook
 * Manages WebSocket connection to agent for A2UI updates
 */
export function useAgentConnection({
  url,
  chatId,
  reconnect = true,
  reconnectInterval = 3000,
  maxReconnectAttempts = 5,
  heartbeatInterval = 30000,
  onMessage,
  onConnect,
  onDisconnect,
  onError,
}: AgentConnectionConfig) {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED)
  const [component, setComponent] = useState<A2UIComponent | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Build WebSocket URL
  const getWebSocketUrl = useCallback(() => {
    const baseUrl = url.replace(/^http/, 'ws')
    return chatId ? `${baseUrl}?chatId=${chatId}` : baseUrl
  }, [url, chatId])

  // Send heartbeat
  const sendHeartbeat = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ping' }))
    }
  }, [])

  // Start heartbeat
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
    }
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, heartbeatInterval)
  }, [heartbeatInterval, sendHeartbeat])

  // Stop heartbeat
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
  }, [])

  // Handle incoming messages
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: A2UIMessage = JSON.parse(event.data)

        // Handle different message types
        switch (message.type) {
          case 'render':
            const renderMsg = message as A2UIRenderMessage
            setComponent(renderMsg.payload.component)
            break

          case 'update':
            const updateMsg = message as A2UIUpdateMessage
            setComponent((prev) => {
              if (!prev) return prev
              // Update specific component by ID
              // This is a simplified implementation
              return {
                ...prev,
                ...updateMsg.payload.updates,
              }
            })
            break

          case 'state':
            const stateMsg = message as A2UIStateMessage
            // Handle state updates
            console.log('[A2UI] State update:', stateMsg.payload.state)
            break

          case 'error':
            console.error('[A2UI] Error from agent:', message.payload)
            setError(new Error(message.payload.message || 'Unknown error'))
            onError?.(new Error(message.payload.message))
            break

          default:
            console.warn('[A2UI] Unknown message type:', message.type)
        }

        onMessage?.(message)
      } catch (error) {
        console.error('[A2UI] Failed to parse message:', error)
      }
    },
    [onMessage, onError]
  )

  // Send action to agent
  const sendAction = useCallback((action: string, context: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: A2UIActionMessage = {
        type: 'action',
        payload: { action, context },
        timestamp: Date.now(),
      }
      wsRef.current.send(JSON.stringify(message))
    } else {
      console.warn('[A2UI] Cannot send action: WebSocket not connected')
    }
  }, [])

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      setStatus(ConnectionStatus.CONNECTING)
      const wsUrl = getWebSocketUrl()
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('[A2UI] WebSocket connected')
        setStatus(ConnectionStatus.CONNECTED)
        setError(null)
        reconnectAttemptsRef.current = 0
        startHeartbeat()
        onConnect?.()
      }

      ws.onmessage = handleMessage

      ws.onerror = (event) => {
        console.error('[A2UI] WebSocket error:', event)
        setStatus(ConnectionStatus.ERROR)
        const error = new Error('WebSocket connection error')
        setError(error)
        onError?.(error)
      }

      ws.onclose = () => {
        console.log('[A2UI] WebSocket disconnected')
        setStatus(ConnectionStatus.DISCONNECTED)
        stopHeartbeat()
        onDisconnect?.()

        // Attempt reconnection
        if (
          reconnect &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          reconnectAttemptsRef.current++
          setStatus(ConnectionStatus.RECONNECTING)

          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(
              `[A2UI] Reconnecting... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
            )
            connect()
          }, reconnectInterval)
        }
      }

      wsRef.current = ws
    } catch (error) {
      console.error('[A2UI] Failed to create WebSocket:', error)
      setStatus(ConnectionStatus.ERROR)
      setError(error as Error)
      onError?.(error as Error)
    }
  }, [
    getWebSocketUrl,
    handleMessage,
    reconnect,
    reconnectInterval,
    maxReconnectAttempts,
    onConnect,
    onDisconnect,
    onError,
    startHeartbeat,
    stopHeartbeat,
  ])

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    stopHeartbeat()

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setStatus(ConnectionStatus.DISCONNECTED)
  }, [stopHeartbeat])

  // Auto-connect on mount
  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status,
    component,
    error,
    connect,
    disconnect,
    sendAction,
    isConnected: status === ConnectionStatus.CONNECTED,
    isConnecting: status === ConnectionStatus.CONNECTING,
    isReconnecting: status === ConnectionStatus.RECONNECTING,
  }
}

/**
 * Agent Connection Status Component
 */
interface AgentConnectionStatusProps {
  status: ConnectionStatus
  error?: Error | null
  onReconnect?: () => void
}

export function AgentConnectionStatus({
  status,
  error,
  onReconnect,
}: AgentConnectionStatusProps) {
  const statusColors = {
    [ConnectionStatus.DISCONNECTED]: 'bg-gray-500',
    [ConnectionStatus.CONNECTING]: 'bg-yellow-500 animate-pulse',
    [ConnectionStatus.CONNECTED]: 'bg-green-500',
    [ConnectionStatus.RECONNECTING]: 'bg-yellow-500 animate-pulse',
    [ConnectionStatus.ERROR]: 'bg-red-500',
  }

  const statusTexts = {
    [ConnectionStatus.DISCONNECTED]: 'Disconnected',
    [ConnectionStatus.CONNECTING]: 'Connecting...',
    [ConnectionStatus.CONNECTED]: 'Connected',
    [ConnectionStatus.RECONNECTING]: 'Reconnecting...',
    [ConnectionStatus.ERROR]: 'Error',
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
      <span className="text-muted-foreground">{statusTexts[status]}</span>
      {error && (
        <span className="text-destructive text-xs">
          {error.message}
        </span>
      )}
      {(status === ConnectionStatus.DISCONNECTED ||
        status === ConnectionStatus.ERROR) &&
        onReconnect && (
          <button
            onClick={onReconnect}
            className="text-xs text-blue-600 hover:underline"
          >
            Reconnect
          </button>
        )}
    </div>
  )
}
