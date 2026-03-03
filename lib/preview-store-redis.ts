import { getRedisClient } from './redis'

// TTL Configuration (24 hours by default, configurable via env)
const DEFAULT_TTL = 24 * 60 * 60 // 24 hours in seconds
const REDIS_TTL = process.env.REDIS_TTL
  ? parseInt(process.env.REDIS_TTL, 10)
  : DEFAULT_TTL

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ChatData {
  preview: string
  messages: ChatMessage[]
  createdAt: string
  name?: string
}

// Redis key prefixes for organization
const PREVIEW_KEY = (id: string) => `preview:${id}`
const CHAT_KEY = (id: string) => `chat:${id}`
const CHAT_LIST_KEY = 'chat:list' // Sorted set for chat ordering

/**
 * Store preview content in Redis with automatic TTL
 * @param id - Unique preview ID
 * @param content - Preview HTML/JSX content
 * @param userMessage - Optional user message for chat history
 */
export async function storePreview(
  id: string,
  content: string,
  userMessage?: string
): Promise<void> {
  const redis = getRedisClient()

  try {
    // Store preview content with TTL
    await redis.setex(PREVIEW_KEY(id), REDIS_TTL, content)
    console.log(
      `Preview stored in Redis with ID: ${id}, TTL: ${REDIS_TTL}s`
    )

    // Get existing chat data or create new
    const existingChatJson = await redis.get(CHAT_KEY(id))
    const existingChat: ChatData | null = existingChatJson
      ? JSON.parse(existingChatJson)
      : null
    const existingMessages = existingChat?.messages || []

    // Build new messages
    const newMessages: ChatMessage[] = []

    if (userMessage) {
      newMessages.push({
        id: `${id}-user-${Date.now()}`,
        role: 'user',
        content: userMessage,
      })
    }

    newMessages.push({
      id: `${id}-assistant-${Date.now()}`,
      role: 'assistant',
      content: content,
    })

    // Combine existing and new messages
    const allMessages = [...existingMessages, ...newMessages]

    // Create chat data object
    const chatData: ChatData = {
      preview: content,
      messages: allMessages,
      createdAt: existingChat?.createdAt || new Date().toISOString(),
      name:
        existingChat?.name ||
        (userMessage
          ? userMessage.slice(0, 50)
          : `Chat ${id.slice(0, 8)}`),
    }

    // Store chat data with TTL
    await redis.setex(CHAT_KEY(id), REDIS_TTL, JSON.stringify(chatData))

    // Add to sorted set for listing (score = timestamp)
    const timestamp = Date.now()
    await redis.zadd(CHAT_LIST_KEY, timestamp, id)

    console.log(`Chat data stored in Redis for ID: ${id}`)
  } catch (error) {
    console.error('Error storing preview in Redis:', error)
    throw error
  }
}

/**
 * Retrieve preview content from Redis
 * @param id - Preview ID
 * @returns Preview content or undefined if not found
 */
export async function getPreview(id: string): Promise<string | undefined> {
  const redis = getRedisClient()

  try {
    const content = await redis.get(PREVIEW_KEY(id))
    console.log(`Preview retrieved from Redis for ID: ${id}, found: ${!!content}`)
    return content || undefined
  } catch (error) {
    console.error('Error retrieving preview from Redis:', error)
    return undefined
  }
}

/**
 * Retrieve chat data including messages
 * @param id - Chat ID
 * @returns Chat data or undefined if not found
 */
export async function getChatData(id: string): Promise<ChatData | undefined> {
  const redis = getRedisClient()

  try {
    const chatJson = await redis.get(CHAT_KEY(id))
    if (!chatJson) return undefined

    return JSON.parse(chatJson)
  } catch (error) {
    console.error('Error retrieving chat data from Redis:', error)
    return undefined
  }
}

/**
 * Check if preview exists in Redis
 * @param id - Preview ID
 */
export async function hasPreview(id: string): Promise<boolean> {
  const redis = getRedisClient()

  try {
    const exists = await redis.exists(PREVIEW_KEY(id))
    return exists === 1
  } catch (error) {
    console.error('Error checking preview existence in Redis:', error)
    return false
  }
}

/**
 * List all stored previews (for debugging)
 * @returns Array of preview IDs
 */
export async function listPreviews(): Promise<string[]> {
  const redis = getRedisClient()

  try {
    const keys = await redis.keys(PREVIEW_KEY('*'))
    return keys.map((key) => key.replace('preview:', ''))
  } catch (error) {
    console.error('Error listing previews from Redis:', error)
    return []
  }
}

/**
 * Get all chats sorted by creation time
 * @returns Array of chat metadata
 */
export async function getAllChats(): Promise<
  Array<{ id: string; name?: string; createdAt: string }>
> {
  const redis = getRedisClient()

  try {
    // Get all chat IDs from sorted set (newest first)
    const chatIds = await redis.zrevrange(CHAT_LIST_KEY, 0, -1)

    // Fetch chat data for each ID
    const chats = await Promise.all(
      chatIds.map(async (id) => {
        const chatData = await getChatData(id)
        if (!chatData) return null

        return {
          id,
          name: chatData.name,
          createdAt: chatData.createdAt,
        }
      })
    )

    // Filter out null values (expired chats)
    return chats.filter((chat): chat is NonNullable<typeof chat> => chat !== null)
  } catch (error) {
    console.error('Error getting all chats from Redis:', error)
    return []
  }
}

/**
 * Update preview with partial content (for streaming)
 * @param id - Preview ID
 * @param partialContent - Partial preview content
 */
export async function updatePreviewPartial(
  id: string,
  partialContent: string
): Promise<void> {
  const redis = getRedisClient()

  try {
    // Update preview without changing TTL
    await redis.setex(PREVIEW_KEY(id), REDIS_TTL, partialContent)
    console.log(
      `Preview updated (streaming) in Redis for ID: ${id}, length: ${partialContent.length}`
    )
  } catch (error) {
    console.error('Error updating partial preview in Redis:', error)
    throw error
  }
}

/**
 * Delete preview and chat data from Redis
 * @param id - Preview ID
 */
export async function deletePreview(id: string): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.del(PREVIEW_KEY(id))
    await redis.del(CHAT_KEY(id))
    await redis.zrem(CHAT_LIST_KEY, id)
    console.log(`Preview and chat data deleted from Redis for ID: ${id}`)
  } catch (error) {
    console.error('Error deleting preview from Redis:', error)
    throw error
  }
}

/**
 * Clean up expired entries from chat list
 * Should be called periodically via cron job
 */
export async function cleanupExpiredChats(): Promise<number> {
  const redis = getRedisClient()

  try {
    const chatIds = await redis.zrange(CHAT_LIST_KEY, 0, -1)
    let removed = 0

    for (const id of chatIds) {
      const exists = await redis.exists(CHAT_KEY(id))
      if (!exists) {
        await redis.zrem(CHAT_LIST_KEY, id)
        removed++
      }
    }

    console.log(`Cleaned up ${removed} expired chat entries`)
    return removed
  } catch (error) {
    console.error('Error cleaning up expired chats:', error)
    return 0
  }
}
