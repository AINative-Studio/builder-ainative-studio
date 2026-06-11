'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'
import Link from 'next/link'
import { UpgradeBanner } from '@/components/upgrade-banner'
import {
  PromptInput,
  PromptInputImageButton,
  PromptInputImagePreview,
  PromptInputMicButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  createImageAttachment,
  createImageAttachmentFromStored,
  savePromptToStorage,
  loadPromptFromStorage,
  clearPromptFromStorage,
  type ImageAttachment,
} from '@/components/ai-elements/prompt-input'
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion'
import { AppHeader } from '@/components/shared/app-header'
import { trackEvent } from '@/components/analytics/google-analytics'
import { useStreaming } from '@/contexts/streaming-context'
import { ChatMessages } from '@/components/chat/chat-messages'
import { ChatInput } from '@/components/chat/chat-input'
import { PreviewPanel } from '@/components/chat/preview-panel'
import { ResizableLayout } from '@/components/shared/resizable-layout'
import { BottomToolbar } from '@/components/shared/bottom-toolbar'
import { FeedbackDialog } from '@/components/feedback-dialog'

// Component that uses useSearchParams - needs to be wrapped in Suspense
function SearchParamsHandler({ onReset }: { onReset: () => void }) {
  const searchParams = useSearchParams()

  // Reset UI when reset parameter is present
  useEffect(() => {
    const reset = searchParams.get('reset')
    if (reset === 'true') {
      onReset()

      // Remove the reset parameter from URL without triggering navigation
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('reset')
      window.history.replaceState({}, '', newUrl.pathname)
    }
  }, [searchParams, onReset])

  return null
}

export function HomeClient() {
  const { status: sessionStatus } = useSession()
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showChatInterface, setShowChatInterface] = useState(false)
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [selectedModel, setSelectedModel] = useState('llama-4-maverick')
  const [isDragOver, setIsDragOver] = useState(false)
  const [chatHistory, setChatHistory] = useState<
    Array<{
      type: 'user' | 'assistant'
      content: string | any
      isStreaming?: boolean
      stream?: ReadableStream<Uint8Array> | null
    }>
  >([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [currentChat, setCurrentChat] = useState<{
    id: string
    demo?: string
  } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [activePanel, setActivePanel] = useState<'chat' | 'preview'>('chat')
  const [buildSteps, setBuildSteps] = useState<string[]>([])
  const [sandpackFiles, setSandpackFiles] = useState<Record<string, string> | null>(null)
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState<'limit-reached' | 'approaching-limit' | null>(null)
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { startHandoff } = useStreaming()

  const handleReset = useCallback(() => {
    // Reset all chat-related state
    setShowChatInterface(false)
    setChatHistory([])
    setCurrentChatId(null)
    setCurrentChat(null)
    setMessage('')
    setAttachments([])
    setIsLoading(false)
    setIsFullscreen(false)
    setSandpackFiles(null)
    setBuildSteps([])
    setRefreshKey((prev) => prev + 1)

    // Clear any stored data
    clearPromptFromStorage()

    // Focus textarea after reset
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
      }
    }, 0)
  }, [])

  // Auto-focus the textarea on page load and restore from sessionStorage
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }

    // Restore prompt data from sessionStorage
    const storedData = loadPromptFromStorage()
    if (storedData) {
      setMessage(storedData.message)
      if (storedData.attachments.length > 0) {
        const restoredAttachments = storedData.attachments.map(
          createImageAttachmentFromStored,
        )
        setAttachments(restoredAttachments)
      }
    }
  }, [])

  // Save prompt data to sessionStorage whenever message or attachments change
  useEffect(() => {
    if (message.trim() || attachments.length > 0) {
      savePromptToStorage(message, attachments)
    } else {
      // Clear sessionStorage if both message and attachments are empty
      clearPromptFromStorage()
    }
  }, [message, attachments])

  // Image attachment handlers
  const handleImageFiles = async (files: File[]) => {
    try {
      const newAttachments = await Promise.all(
        files.map((file) => createImageAttachment(file)),
      )
      setAttachments((prev) => [...prev, ...newAttachments])
    } catch (error) {
      console.error('Error processing image files:', error)
    }
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id))
  }

  const handleDragOver = () => {
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = () => {
    setIsDragOver(false)
  }

  // Auto-sign-in as guest if not authenticated
  const ensureAuthenticated = useCallback(async () => {
    if (sessionStatus === 'unauthenticated') {
      await signIn('guest', { redirect: false })
      // Wait briefly for session to update
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }, [sessionStatus])

  const handleSendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    console.log('handleSendMessage called with message:', message)
    if (!message.trim() || isLoading) return

    // Ensure user is authenticated (auto-create guest session if needed)
    await ensureAuthenticated()

    trackEvent('generate_app', 'engagement', message.trim().slice(0, 50))

    const userMessage = message.trim()
    const currentAttachments = [...attachments]

    // Clear sessionStorage immediately upon submission
    clearPromptFromStorage()

    setMessage('')
    setAttachments([])

    // Immediately show chat interface and add user message
    setShowChatInterface(true)
    setChatHistory((prev) => [
      ...prev,
      {
        type: 'user',
        content: userMessage,
      },
    ])
    setIsLoading(true)
    setBuildSteps([]) // Clear previous build steps

    try {
      const endpoint = '/api/chat-ws' // WebSocket-style streaming endpoint
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          chatId: currentChatId,
          model: selectedModel,
        }),
      })

      if (!response.ok) {
        if (response.status === 429) {
          setShowUpgrade('limit-reached')
          throw new Error('You\'ve reached your generation limit. Upgrade to Pro for 100x more tokens and Claude Sonnet 4.')
        }
        let errorMessage = 'Sorry, there was an error processing your message. Please try again.'
        try {
          const errorData = await response.json()
          if (errorData.message) errorMessage = errorData.message
        } catch (parseError) {
          console.error('Error parsing error response:', parseError)
        }
        throw new Error(errorMessage)
      }

      // Handle streaming response
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response body')
      }

      let accumulatedContent = ''
      let chatId = currentChatId

      // Add placeholder message for streaming
      setChatHistory((prev) => [
        ...prev,
        {
          type: 'assistant',
          content: '',
          isStreaming: true,
        },
      ])

      try {
        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            setIsLoading(false)
            break
          }

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))

                // Handle different event types from WebSocket-style streaming
                switch (data.type) {
                  case 'init':
                    // Initialize chat ID and set preview URL immediately
                    chatId = data.chatId
                    setCurrentChatId(data.chatId)
                    console.log('[DEBUG] Init event received:', {
                      chatId: data.chatId,
                      demo: data.demo,
                      hasDemoUrl: !!data.demo
                    })

                    // Store demo URL but DON'T load preview yet — content isn't generated
                    // Preview will load when 'complete' event fires with refreshKey bump
                    if (data.demo) {
                      setCurrentChat({
                        id: data.chatId,
                        demo: data.demo
                      })
                      console.log('[DEBUG] Preview URL set from init (will refresh on complete):', data.demo)
                    }
                    break

                  case 'build_step':
                    // Add build step to the list
                    setBuildSteps((prev) => [...prev, data.step])
                    break

                  case 'chunk':
                    // Accumulate content from each chunk
                    accumulatedContent += data.content

                    // Update the streaming message with accumulated content
                    setChatHistory((prev) => {
                      const updated = [...prev]
                      const lastIndex = updated.length - 1
                      if (lastIndex >= 0 && updated[lastIndex].isStreaming) {
                        updated[lastIndex] = {
                          ...updated[lastIndex],
                          content: accumulatedContent,
                        }
                      }
                      return updated
                    })
                    break

                  case 'refresh':
                    // Preview refresh disabled during streaming - preview shows after completion
                    break

                  case 'complete':
                    // Stream complete
                    console.log('WebSocket stream complete, chatId:', data.chatId)
                    console.log('Setting isLoading to FALSE')
                    chatId = data.chatId

                    // Update with final content and demo URL
                    setChatHistory((prev) => {
                      const updated = [...prev]
                      const lastIndex = updated.length - 1
                      if (lastIndex >= 0) {
                        updated[lastIndex] = {
                          ...updated[lastIndex],
                          content: accumulatedContent,
                          isStreaming: false,
                        }
                      }
                      return updated
                    })

                    // Set chat data with demo URL
                    console.log('[DEBUG] Complete event received:', {
                      chatId: data.chatId,
                      demo: data.demo,
                      hasDemoUrl: !!data.demo
                    })
                    setCurrentChat({
                      id: data.chatId,
                      demo: data.demo
                    })
                    setCurrentChatId(data.chatId)
                    setIsLoading(false)
                    console.log('[DEBUG] isLoading state updated to FALSE, preview URL:', data.demo)

                    // Force refresh the preview iframe now that content is ready
                    setRefreshKey((prev) => prev + 1)

                    // Clear build steps when generation completes
                    // Keep them visible briefly, then clear
                    setTimeout(() => {
                      setBuildSteps([])
                    }, 2000)
                    break

                  case 'files':
                    // Sandpack file map from multi-file generation
                    console.log('[DEBUG] Files event received:', Object.keys(data.files).length, 'files')
                    setSandpackFiles(data.files)
                    break

                  case 'validation_error':
                    console.warn('Code validation error:', data.error)
                    // Still show the chat, but the preview will display the validation error page
                    break

                  case 'error':
                    console.error('WebSocket stream error:', data.error)
                    setIsLoading(false)
                    break
                }
              } catch (parseError) {
                console.error('Error parsing SSE data:', parseError)
              }
            }
          }
        }
      } catch (streamError) {
        console.error('Stream reading error:', streamError)
        setIsLoading(false)
      }
    } catch (error) {
      console.error('Error creating chat:', error)
      setIsLoading(false)

      // Use the specific error message if available, otherwise fall back to generic message
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Sorry, there was an error processing your message. Please try again.'

      setChatHistory((prev) => [
        ...prev,
        {
          type: 'assistant',
          content: errorMessage,
        },
      ])
    }
  }

  const handleChatData = async (chatData: any) => {
    if (chatData.id) {
      // Only set currentChat if it's not already set or if this is the main chat object
      if (!currentChatId || chatData.object === 'chat') {
        setCurrentChatId(chatData.id)
        setCurrentChat({ id: chatData.id })

        // Update URL without triggering Next.js routing
        window.history.pushState(null, '', `/chats/${chatData.id}`)
      }

      // Create ownership record for new chat (only if this is a new chat)
      if (!currentChatId) {
        try {
          await fetch('/api/chat/ownership', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chatId: chatData.id,
            }),
          })
        } catch (error) {
          console.error('Failed to create chat ownership:', error)
          // Don't fail the UI if ownership creation fails
        }
      }
    }
  }

  const handleStreamingComplete = async (finalContent: any) => {
    setIsLoading(false)

    // Update chat history with final content
    setChatHistory((prev) => {
      const updated = [...prev]
      const lastIndex = updated.length - 1
      if (lastIndex >= 0 && updated[lastIndex].isStreaming) {
        updated[lastIndex] = {
          ...updated[lastIndex],
          content: finalContent,
          isStreaming: false,
          stream: undefined,
        }
      }
      return updated
    })

    // Fetch demo URL after streaming completes
    // Use the current state by accessing it in the state updater
    setCurrentChat((prevCurrentChat) => {
      if (prevCurrentChat?.id) {
        // Fetch demo URL asynchronously
        fetch(`/api/chats/${prevCurrentChat.id}`)
          .then((response) => {
            if (response.ok) {
              return response.json()
            } else {
              console.warn('Failed to fetch chat details:', response.status)
              return null
            }
          })
          .then((chatDetails) => {
            if (chatDetails) {
              const demoUrl =
                chatDetails?.latestVersion?.demoUrl || chatDetails?.demo

              // Update the current chat with demo URL
              if (demoUrl) {
                setCurrentChat((prev) =>
                  prev ? { ...prev, demo: demoUrl } : null,
                )
                if (window.innerWidth < 768) {
                  setActivePanel('preview')
                }
              }
            }
          })
          .catch((error) => {
            console.error('Error fetching demo URL:', error)
          })
      }

      // Return the current state unchanged for now
      return prevCurrentChat
    })
  }

  const handleChatSendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!message.trim() || isLoading || !currentChatId) return

    const userMessage = message.trim()
    setMessage('')
    setIsLoading(true)

    // Add user message to chat history
    setChatHistory((prev) => [...prev, { type: 'user', content: userMessage }])

    try {
      const endpoint = '/api/chat'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          chatId: currentChatId,
          model: selectedModel,
          streaming: true,
        }),
      })

      if (!response.ok) {
        // Try to get the specific error message from the response
        if (response.status === 429) {
          setShowUpgrade('limit-reached')
          throw new Error('You\'ve reached your generation limit. Upgrade to Pro for 100x more tokens and Claude Sonnet 4.')
        }
        let errorMessage = 'Sorry, there was an error processing your message. Please try again.'
        try {
          const errorData = await response.json()
          if (errorData.message) errorMessage = errorData.message
        } catch (parseError) {
          console.error('Error parsing error response:', parseError)
        }
        throw new Error(errorMessage)
      }

      if (!response.body) {
        throw new Error('No response body for streaming')
      }

      setIsLoading(false)

      // Add streaming response
      setChatHistory((prev) => [
        ...prev,
        {
          type: 'assistant',
          content: [],
          isStreaming: true,
          stream: response.body,
        },
      ])
    } catch (error) {
      console.error('Error:', error)

      // Use the specific error message if available, otherwise fall back to generic message
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Sorry, there was an error processing your message. Please try again.'

      setChatHistory((prev) => [
        ...prev,
        {
          type: 'assistant',
          content: errorMessage,
        },
      ])
      setIsLoading(false)
    }
  }

  if (showChatInterface) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black flex flex-col">
        {/* Handle search params with Suspense boundary */}
        <Suspense fallback={null}>
          <SearchParamsHandler onReset={handleReset} />
        </Suspense>

        <AppHeader>
        </AppHeader>

        <div className="flex flex-col h-[calc(100vh-64px-40px)] md:h-[calc(100vh-64px)]">
          <ResizableLayout
            className="flex-1 min-h-0"
            singlePanelMode={false}
            activePanel={activePanel === 'chat' ? 'left' : 'right'}
            leftPanel={
              <div className="flex flex-col h-full">
                <div className="flex-1 overflow-y-auto">
                  <ChatMessages
                    chatHistory={chatHistory}
                    isLoading={isLoading}
                    currentChat={currentChat}
                    onStreamingComplete={handleStreamingComplete}
                    onChatData={handleChatData}
                    onStreamingStarted={() => setIsLoading(false)}
                    buildSteps={buildSteps}
                    sandpackFiles={sandpackFiles}
                  />
                </div>

                {showUpgrade && (
                  <UpgradeBanner type={showUpgrade} onDismiss={() => setShowUpgrade(null)} />
                )}

                <ChatInput
                  message={message}
                  setMessage={setMessage}
                  onSubmit={handleChatSendMessage}
                  isLoading={isLoading}
                  showSuggestions={false}
                />
              </div>
            }
            rightPanel={
              <PreviewPanel
                currentChat={currentChat}
                isFullscreen={isFullscreen}
                setIsFullscreen={setIsFullscreen}
                refreshKey={refreshKey}
                setRefreshKey={setRefreshKey}
                isGenerating={isLoading}
                buildSteps={buildSteps}
                sandpackFiles={sandpackFiles}
              />
            }
          />

          <div className="md:hidden">
            <BottomToolbar
              activePanel={activePanel}
              onPanelChange={setActivePanel}
              hasPreview={!!currentChat}
            />
          </div>
        </div>

        {/* Simplified streaming display */}
        {chatHistory.some((msg) => msg.isStreaming) && (
          <div className="hidden">
            {/* LLAMA streaming handled directly by chat interface */}
          </div>
        )}

        {/* Feedback Dialog */}
        <FeedbackDialog
          open={showFeedbackDialog}
          onOpenChange={setShowFeedbackDialog}
          chatId={currentChatId}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black flex flex-col" data-agent-role="application" data-agent-context="ai-builder">
      {/* Handle search params with Suspense boundary */}
      <Suspense fallback={null}>
        <SearchParamsHandler onReset={handleReset} />
      </Suspense>

      <AppHeader />

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8" aria-label="AI Application Builder">
        <div className="max-w-4xl w-full">
          <section className="text-center mb-8 md:mb-12" aria-label="Hero" data-agent-role="hero" data-agent-context="value-proposition">
            <p className="text-sm font-semibold text-[#5867EF] tracking-wide uppercase mb-3">AI App Builder — Best v0, Lovable & Bolt Alternative</p>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
              Build React Apps with AI in Seconds
            </h1>
            <p className="text-base text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              Generate production-ready React components from prompts. Every app is agent-optimized with AX, SEO, and structured data built in.
            </p>
          </section>

          {/* Prompt Input */}
          <div className="max-w-2xl mx-auto">
            <PromptInput
              onSubmit={handleSendMessage}
              className="w-full relative"
              onImageDrop={handleImageFiles}
              isDragOver={isDragOver}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <PromptInputImagePreview
                attachments={attachments}
                onRemove={handleRemoveAttachment}
              />
              <PromptInputTextarea
                ref={textareaRef}
                onChange={(e) => setMessage(e.target.value)}
                value={message}
                placeholder="Describe your AINative application..."
                className="min-h-[80px] text-base"
                disabled={isLoading}
              />
              <PromptInputToolbar>
                <PromptInputTools>
                  <PromptInputImageButton
                    onImageSelect={handleImageFiles}
                    disabled={isLoading}
                  />
                  {/* Model Selector - only shown to authenticated users */}
                  {sessionStatus === 'authenticated' && (
                    <div className="relative">
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={isLoading}
                        className="appearance-none h-8 pl-2 pr-7 text-xs font-medium bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5867EF]/20"
                        title="Select AI model"
                      >
                        <optgroup label="Llama Models">
                          <option value="llama-4-maverick">Llama 4 Maverick 17B (Default)</option>
                          <option value="llama-4-scout">Llama 4 Scout 17B</option>
                        </optgroup>
                        <optgroup label="Code Specialists">
                          <option value="qwen-coder-32b">Qwen Coder 32B</option>
                          <option value="qwen-coder-7b">Qwen Coder 7B (Fast)</option>
                          <option value="nouscoder-14b">NousCoder 14B</option>
                        </optgroup>
                        <optgroup label="General">
                          <option value="gemma-9b">Gemma 9B</option>
                          <option value="gemma-2b">Gemma 2B (Ultra-fast)</option>
                          <option value="deepseek-r1-distill-qwen-7b">DeepSeek R1 Qwen 7B</option>
                          <option value="deepseek-r1-distill-llama-8b">DeepSeek R1 Llama 8B</option>
                        </optgroup>
                      </select>
                      <svg className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  )}
                </PromptInputTools>
                <PromptInputTools>
                  <PromptInputMicButton
                    onTranscript={(transcript) => {
                      setMessage(
                        (prev) => prev + (prev ? ' ' : '') + transcript,
                      )
                    }}
                    onError={(error) => {
                      console.error('Speech recognition error:', error)
                    }}
                    disabled={isLoading}
                  />
                  <PromptInputSubmit
                    disabled={!message.trim() || isLoading}
                    status={isLoading ? 'streaming' : 'ready'}
                  />
                </PromptInputTools>
              </PromptInputToolbar>
            </PromptInput>
          </div>

          {/* AINative Application Archetypes */}
          <div className="mt-4 max-w-2xl mx-auto">
            <Suggestions>
              {[
                { label: 'Agent Dashboard', prompt: 'Build an AINative agent monitoring dashboard with SwarmView showing active agents, MetricCards with sparklines for token usage and success rates, AgentTimeline for execution traces, GuardrailPanel for safety rules, and ConnectionStatus indicators' },
                { label: 'AI Chat Interface', prompt: 'Build an AINative AI chat interface with ChatBubble messages, StreamingIndicator for typing state, CodeDisplay for code responses, a conversation sidebar, and agent-optimized semantic HTML structure' },
                { label: 'SaaS Platform', prompt: 'Build an AINative SaaS landing page with hero section, feature cards with Lucide icons, pricing tiers using AIKitPriceCard, testimonials, and agent-readable structured data throughout' },
                { label: 'Swarm Monitor', prompt: 'Build an AINative multi-agent swarm operations center with SwarmView, multiple AgentCards showing status and tasks, TokenUsageBar for budget tracking, SafetyBadge trust scores, and real-time AgentTimeline' },
                { label: 'E-commerce Store', prompt: 'Build an AINative e-commerce storefront with AIKitProductCard grid, AIKitRating reviews, AIKitBreadcrumb navigation, AIKitPagination, and AIKitBanner for promotions, optimized for agent-first browsing' },
                { label: 'Admin Panel', prompt: 'Build an AINative admin panel with AIKitSidebar navigation, AIKitTable with sortable data, MetricCards for KPIs, AIKitStepper for workflows, AIKitBreadcrumb, and role-based access indicators' },
                { label: 'Analytics Dashboard', prompt: 'Build an AINative analytics dashboard with AIKitSidebar, MetricCards with sparklineData, Recharts AreaChart and BarChart visualizations, AIKitTable for data, and AIKitTimeline for events' },
                { label: 'AI Safety Dashboard', prompt: 'Build an AINative AI safety and compliance dashboard with GuardrailPanel showing pass/fail rules, SafetyBadge trust scores, AgentTimeline for audit trail, TokenUsageBar for consumption, and AIKitBanner alerts' },
              ].map((item) => (
                <Suggestion
                  key={item.label}
                  onClick={() => {
                    setMessage(item.prompt)
                    setTimeout(() => {
                      const form = textareaRef.current?.form
                      if (form) {
                        form.requestSubmit()
                      }
                    }, 0)
                  }}
                  suggestion={item.label}
                />
              ))}
            </Suggestions>
          </div>

        </div>
      </main>
    </div>
  )
}
