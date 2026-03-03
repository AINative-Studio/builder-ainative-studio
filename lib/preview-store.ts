// Simple in-memory store for preview content and chat messages
// Using global to persist across hot module reloads in development

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  total_tokens: number
  estimated_cost: number
}

interface ChatData {
  preview: string
  messages: ChatMessage[]
  createdAt: string
  name?: string
  validationError?: string
  isStreaming?: boolean
  usage?: TokenUsage
}

declare global {
  var __previewStore: Map<string, string> | undefined
  var __chatStore: Map<string, ChatData> | undefined
}

// Use global store in development to persist across hot reloads
const previewStore = global.__previewStore || new Map<string, string>()
const chatStore = global.__chatStore || new Map<string, ChatData>()

if (!global.__previewStore) {
  global.__previewStore = previewStore
}

if (!global.__chatStore) {
  global.__chatStore = chatStore
}

export function storePreview(
  id: string,
  content: string,
  userMessage?: string,
  metadata?: { validationError?: string; usage?: TokenUsage }
): void {
  previewStore.set(id, content)
  console.log(`Preview stored with ID: ${id}, total stored: ${previewStore.size}`)

  // Get existing chat data or create new
  const existingChat = chatStore.get(id)
  const existingMessages = existingChat?.messages || []

  // Build new messages
  const newMessages: ChatMessage[] = []

  if (userMessage) {
    newMessages.push({
      id: `${id}-user-${Date.now()}`,
      role: 'user',
      content: userMessage
    })
  }

  newMessages.push({
    id: `${id}-assistant-${Date.now()}`,
    role: 'assistant',
    content: content
  })

  // Combine existing and new messages
  const allMessages = [...existingMessages, ...newMessages]

  chatStore.set(id, {
    preview: content,
    messages: allMessages,
    createdAt: existingChat?.createdAt || new Date().toISOString(),
    name: existingChat?.name || (userMessage ? userMessage.slice(0, 50) : `Chat ${id.slice(0, 8)}`),
    validationError: metadata?.validationError,
    isStreaming: false,  // Mark as complete
    usage: metadata?.usage
  })

  // Clean up old previews after 24 hours (increased from 1 hour)
  setTimeout(() => {
    previewStore.delete(id)
    chatStore.delete(id)
  }, 24 * 60 * 60 * 1000)
}

export function getPreview(id: string): string | undefined {
  const content = previewStore.get(id)
  console.log(`Preview retrieved for ID: ${id}, found: ${!!content}`)
  return content
}

export function getChatData(id: string): ChatData | undefined {
  return chatStore.get(id)
}

export function hasPreview(id: string): boolean {
  return previewStore.has(id)
}

// Debug function to list all stored previews
export function listPreviews(): string[] {
  return Array.from(previewStore.keys())
}

// Get all chats (for chat selector)
export function getAllChats(): Array<{ id: string; name?: string; createdAt: string }> {
  return Array.from(chatStore.entries())
    .map(([id, data]) => ({
      id,
      name: data.name,
      createdAt: data.createdAt
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// Update preview with partial content (for streaming)
export function updatePreviewPartial(id: string, partialContent: string): void {
  previewStore.set(id, partialContent)

  // Mark as streaming or update existing streaming preview
  const existingChat = chatStore.get(id)
  if (existingChat) {
    chatStore.set(id, {
      ...existingChat,
      preview: partialContent,
      isStreaming: true
    })
  } else {
    // Create initial chat data for streaming
    chatStore.set(id, {
      preview: partialContent,
      messages: [],
      createdAt: new Date().toISOString(),
      isStreaming: true
    })
  }

  console.log(`Preview updated (streaming) for ID: ${id}, length: ${partialContent.length}`)
}

// Check if preview is currently streaming
export function isPreviewStreaming(id: string): boolean {
  const chatData = chatStore.get(id)
  return chatData?.isStreaming ?? false
}

// Get token usage statistics for all chats
export function getAllUsageStats(): {
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  totalTokens: number
  totalCost: number
  chatCount: number
  chats: Array<{ id: string; name?: string; usage?: TokenUsage }>
} {
  const chats = Array.from(chatStore.entries()).map(([id, data]) => ({
    id,
    name: data.name,
    usage: data.usage
  }))

  const totals = chats.reduce((acc, chat) => {
    if (chat.usage) {
      acc.totalInputTokens += chat.usage.input_tokens
      acc.totalOutputTokens += chat.usage.output_tokens
      acc.totalCacheCreationTokens += chat.usage.cache_creation_input_tokens || 0
      acc.totalCacheReadTokens += chat.usage.cache_read_input_tokens || 0
      acc.totalTokens += chat.usage.total_tokens
      acc.totalCost += chat.usage.estimated_cost
      acc.chatCount++
    }
    return acc
  }, {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    chatCount: 0
  })

  return {
    ...totals,
    chats
  }
}