import React, { useRef, useEffect, useState } from 'react'
import { Message, MessageContent } from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'
import { Loader } from '@/components/ai-elements/loader'
import { MessageRenderer } from '@/components/message-renderer'
import { sharedComponents } from '@/components/shared-components'
import { BuildProgress, BuildTask } from '@/components/chat/build-progress'
import { FileTree, FileGroup } from '@/components/chat/file-tree'
import { createFileTree, simulateFileProgress } from '@/lib/file-parser'
import { StreamingMessage } from '@/components/aikit/StreamingMessage'

interface ChatMessage {
  type: 'user' | 'assistant'
  content: string | any
  isStreaming?: boolean
  stream?: ReadableStream<Uint8Array> | null
  buildTasks?: BuildTask[]
}

interface Chat {
  id: string
  demo?: string
  url?: string
}

interface ChatMessagesProps {
  chatHistory: ChatMessage[]
  isLoading: boolean
  currentChat: Chat | null
  onStreamingComplete: (finalContent: any) => void
  onChatData: (chatData: any) => void
  onStreamingStarted?: () => void
  buildSteps?: string[]
}

export function ChatMessages({
  chatHistory,
  isLoading,
  currentChat,
  onStreamingComplete,
  onChatData,
  onStreamingStarted,
  buildSteps = [],
}: ChatMessagesProps) {
  const streamingStartedRef = useRef(false)
  const [buildTasks, setBuildTasks] = useState<BuildTask[]>([])
  const [fileGroups, setFileGroups] = useState<FileGroup[]>([])

  // Reset the streaming started flag when a new message starts loading
  useEffect(() => {
    if (isLoading) {
      streamingStartedRef.current = false

      // Get the last user message to determine file structure
      const lastUserMessage = chatHistory
        .slice()
        .reverse()
        .find((msg) => msg.type === 'user')

      const userPrompt = typeof lastUserMessage?.content === 'string'
        ? lastUserMessage.content
        : 'Create a component'

      // Create file tree based on the prompt
      const files = createFileTree(userPrompt)
      setFileGroups(files)

      // Start simulating file progress
      const cleanup = simulateFileProgress(files, setFileGroups)

      // Initialize build tasks when generation starts
      setBuildTasks([
        {
          id: '1',
          type: 'configure',
          status: 'in_progress',
          description: 'Analyzing requirements and selecting components'
        },
        {
          id: '2',
          type: 'create',
          status: 'pending',
          description: 'Generating component structure',
          fileName: 'Dashboard.jsx'
        },
        {
          id: '3',
          type: 'update',
          status: 'pending',
          description: 'Adding mock data and styling'
        },
        {
          id: '4',
          type: 'install',
          status: 'pending',
          description: 'Loading preview environment'
        }
      ])

      return cleanup
    }
  }, [isLoading, chatHistory])

  // Update build tasks as generation progresses
  useEffect(() => {
    if (buildTasks.length > 0 && buildTasks.some(t => t.status === 'in_progress')) {
      const timer = setTimeout(() => {
        setBuildTasks(prev => {
          const updated = [...prev]
          const inProgressIndex = updated.findIndex(t => t.status === 'in_progress')

          if (inProgressIndex !== -1) {
            updated[inProgressIndex].status = 'completed'

            // Move to next task
            if (inProgressIndex < updated.length - 1) {
              updated[inProgressIndex + 1].status = 'in_progress'
            } else if (!isLoading) {
              // All tasks completed
              setTimeout(() => setBuildTasks([]), 2000)
            }
          }

          return updated
        })
      }, 1500)

      return () => clearTimeout(timer)
    }
  }, [buildTasks, isLoading])

  if (chatHistory.length === 0) {
    return (
      <Conversation>
        <ConversationContent>
          <div>
            {/* Empty conversation - messages will appear here when they load */}
          </div>
        </ConversationContent>
      </Conversation>
    )
  }

  return (
    <>
      <Conversation>
        <ConversationContent>
          {chatHistory.map((msg, index) => {
            // Extract conversational text without code blocks for assistant messages
            let displayContent = typeof msg.content === 'string' ? msg.content : ''

            if (msg.type === 'assistant' && displayContent) {
              // Remove code blocks from assistant messages (users shouldn't see raw code)
              // Extract the conversational part before the code block
              const codeBlockRegex = /```[\s\S]*?```/g
              const beforeCode = displayContent.split('```')[0]

              // If there's conversational text before the code, show only that
              if (beforeCode && beforeCode.trim()) {
                displayContent = beforeCode.trim()
              } else {
                // If no conversational text, show a friendly message
                displayContent = "Component generated successfully! Check the preview panel to see your creation."
              }
            }

            return (
              <div key={index}>
                <StreamingMessage
                  role={msg.type}
                  content={displayContent}
                  streamingState={msg.isStreaming ? 'streaming' : 'complete'}
                  enableMarkdown={true}
                  animationType={msg.type === 'user' ? 'none' : 'typewriter'}
                  animationSpeed={20}
                  showStreamingIndicator={msg.isStreaming}
                  codeTheme="dark"
                  enableCodeCopy={false}
                  showTimestamp={false}
                  roleColors={{
                    user: '#3b82f6',
                    assistant: '#10b981',
                    system: '#f59e0b',
                  }}
                />

                {/* Show project setup card (build steps from backend) right after user message */}
                {msg.type === 'user' && index === chatHistory.length - 2 && buildSteps.length > 0 && (
                    <div className="mt-4 w-full max-w-2xl">
                      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                        <div className="font-semibold text-sm text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Project Setup
                        </div>
                        <div className="space-y-3">
                          {buildSteps.map((step, stepIndex) => (
                            <div key={stepIndex} className="flex items-start gap-3 text-sm">
                              <div className="mt-0.5">
                                <svg className="w-4 h-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              </div>
                              <span className="text-gray-700 dark:text-gray-300 leading-relaxed">{step}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                )}

                {/* Show build progress and file tree for assistant messages */}
                {msg.type === 'assistant' &&
                 index === chatHistory.length - 1 &&
                 (buildTasks.length > 0 || fileGroups.length > 0) && (
                <div className="mt-4 space-y-4 w-full max-w-2xl">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Component generated successfully
                  </div>
                  <BuildProgress tasks={buildTasks} />
                  <FileTree groups={fileGroups} />
                </div>
                )}
              </div>
            )
          })}
          {isLoading && (
            <div className="flex justify-center py-4">
              <Loader size={16} className="text-gray-500 dark:text-gray-400" />
            </div>
          )}
        </ConversationContent>
      </Conversation>
    </>
  )
}
