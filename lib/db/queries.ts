import 'server-only'

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from 'drizzle-orm'

import {
  users,
  chat_ownerships,
  anonymous_chat_logs,
  chats,
  messages,
  sessions,
  design_tokens,
  generations,
  type User,
  type ChatOwnership,
  type AnonymousChatLog,
  type Chat,
  type Message,
  type Session,
  type DesignToken,
  type Generation,
} from './schema'
import { generateUUID } from '../utils'
import { generateHashedPassword } from './utils'
import db from './connection'

export async function getUser(email: string): Promise<Array<User>> {
  try {
    return await db.select().from(users).where(eq(users.email, email))
  } catch (error) {
    console.error('Failed to get user from database')
    throw error
  }
}

export async function createUser(
  email: string,
  password: string,
): Promise<User[]> {
  try {
    const hashedPassword = generateHashedPassword(password)
    return await db
      .insert(users)
      .values({
        email,
        password: hashedPassword,
      })
      .returning()
  } catch (error) {
    console.error('Failed to create user in database')
    throw error
  }
}

export async function createGuestUser(): Promise<User[]> {
  try {
    const guestId = generateUUID()
    const guestEmail = `guest-${guestId}@example.com`

    return await db
      .insert(users)
      .values({
        email: guestEmail,
        password: generateHashedPassword(generateUUID()),
      })
      .returning()
  } catch (error) {
    console.error('Failed to create guest user in database')
    throw error
  }
}

// Chat ownership functions
export async function createChatOwnership({
  v0ChatId,
  userId,
}: {
  v0ChatId: string
  userId: string
}) {
  try {
    return await db
      .insert(chat_ownerships)
      .values({
        v0_chat_id: v0ChatId,
        user_id: userId,
      })
      .onConflictDoNothing({ target: chat_ownerships.v0_chat_id })
  } catch (error) {
    console.error('Failed to create chat ownership in database')
    throw error
  }
}

export async function getChatOwnership({ v0ChatId }: { v0ChatId: string }) {
  try {
    const [ownership] = await db
      .select()
      .from(chat_ownerships)
      .where(eq(chat_ownerships.v0_chat_id, v0ChatId))
    return ownership
  } catch (error) {
    console.error('Failed to get chat ownership from database')
    throw error
  }
}

export async function getChatIdsByUserId({
  userId,
}: {
  userId: string
}): Promise<string[]> {
  try {
    const ownerships = await db
      .select({ v0ChatId: chat_ownerships.v0_chat_id })
      .from(chat_ownerships)
      .where(eq(chat_ownerships.user_id, userId))
      .orderBy(desc(chat_ownerships.created_at))

    return ownerships.map((o: { v0ChatId: string }) => o.v0ChatId)
  } catch (error) {
    console.error('Failed to get chat IDs by user from database')
    throw error
  }
}

export async function deleteChatOwnership({ v0ChatId }: { v0ChatId: string }) {
  try {
    return await db
      .delete(chat_ownerships)
      .where(eq(chat_ownerships.v0_chat_id, v0ChatId))
  } catch (error) {
    console.error('Failed to delete chat ownership from database')
    throw error
  }
}

// Rate limiting functions
export async function getChatCountByUserId({
  userId,
  differenceInHours,
}: {
  userId: string
  differenceInHours: number
}): Promise<number> {
  try {
    const hoursAgo = new Date(Date.now() - differenceInHours * 60 * 60 * 1000)

    const [stats] = await db
      .select({ count: count(chat_ownerships.id) })
      .from(chat_ownerships)
      .where(
        and(
          eq(chat_ownerships.user_id, userId),
          gte(chat_ownerships.created_at, hoursAgo),
        ),
      )

    return stats?.count || 0
  } catch (error) {
    console.error('Failed to get chat count by user from database')
    throw error
  }
}

export async function getChatCountByIP({
  ipAddress,
  differenceInHours,
}: {
  ipAddress: string
  differenceInHours: number
}): Promise<number> {
  try {
    const hoursAgo = new Date(Date.now() - differenceInHours * 60 * 60 * 1000)

    const [stats] = await db
      .select({ count: count(anonymous_chat_logs.id) })
      .from(anonymous_chat_logs)
      .where(
        and(
          eq(anonymous_chat_logs.ip_address, ipAddress),
          gte(anonymous_chat_logs.created_at, hoursAgo),
        ),
      )

    return stats?.count || 0
  } catch (error) {
    console.error('Failed to get chat count by IP from database')
    throw error
  }
}

export async function createAnonymousChatLog({
  ipAddress,
  v0ChatId,
}: {
  ipAddress: string
  v0ChatId: string
}) {
  try {
    return await db.insert(anonymous_chat_logs).values({
      ip_address: ipAddress,
      v0_chat_id: v0ChatId,
    })
  } catch (error) {
    console.error('Failed to create anonymous chat log in database')
    throw error
  }
}

// ==================== US-002: Chat History Persistence ====================

/**
 * Create a new chat
 */
export async function createChat({
  chatId,
  userId,
  name,
}: {
  chatId: string
  userId: string
  name?: string
}): Promise<Chat[]> {
  try {
    return await db
      .insert(chats)
      .values({
        id: chatId,
        user_id: userId,
        name: name || `Chat ${chatId.slice(0, 8)}`,
      })
      .returning()
  } catch (error) {
    console.error('Failed to create chat in database:', error)
    throw error
  }
}

/**
 * Get a single chat by ID
 */
export async function getChat(chatId: string): Promise<Chat | undefined> {
  try {
    const [chat] = await db
      .select()
      .from(chats)
      .where(eq(chats.id, chatId))
    return chat
  } catch (error) {
    console.error('Failed to get chat from database:', error)
    throw error
  }
}

/**
 * Get all chats for a user
 */
export async function getChatsByUserId(userId: string): Promise<Chat[]> {
  try {
    return await db
      .select()
      .from(chats)
      .where(eq(chats.user_id, userId))
      .orderBy(desc(chats.created_at))
  } catch (error) {
    console.error('Failed to get chats by user from database:', error)
    throw error
  }
}

/**
 * Update chat name
 */
export async function updateChatName({
  chatId,
  name,
}: {
  chatId: string
  name: string
}): Promise<Chat[]> {
  try {
    return await db
      .update(chats)
      .set({
        name,
        updated_at: new Date(),
      })
      .where(eq(chats.id, chatId))
      .returning()
  } catch (error) {
    console.error('Failed to update chat name in database:', error)
    throw error
  }
}

/**
 * Delete a chat (cascade will delete messages)
 */
export async function deleteChat(chatId: string): Promise<void> {
  try {
    await db.delete(chats).where(eq(chats.id, chatId))
  } catch (error) {
    console.error('Failed to delete chat from database:', error)
    throw error
  }
}

/**
 * Create a new message in a chat
 */
export async function createMessage({
  messageId,
  chatId,
  role,
  content,
}: {
  messageId: string
  chatId: string
  role: 'user' | 'assistant' | 'system'
  content: string
}): Promise<Message[]> {
  try {
    const result = await db
      .insert(messages)
      .values({
        id: messageId,
        chat_id: chatId,
        role,
        content,
      })
      .returning()

    // Update chat's updated_at timestamp
    await db
      .update(chats)
      .set({ updated_at: new Date() })
      .where(eq(chats.id, chatId))

    return result
  } catch (error) {
    console.error('Failed to create message in database:', error)
    throw error
  }
}

/**
 * Get all messages for a chat, ordered chronologically
 */
export async function getMessagesByChatId(
  chatId: string
): Promise<Message[]> {
  try {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.chat_id, chatId))
      .orderBy(asc(messages.created_at))
  } catch (error) {
    console.error('Failed to get messages from database:', error)
    throw error
  }
}

/**
 * Get a single message by ID
 */
export async function getMessage(
  messageId: string
): Promise<Message | undefined> {
  try {
    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
    return message
  } catch (error) {
    console.error('Failed to get message from database:', error)
    throw error
  }
}

/**
 * Delete a message
 */
export async function deleteMessage(messageId: string): Promise<void> {
  try {
    await db.delete(messages).where(eq(messages.id, messageId))
  } catch (error) {
    console.error('Failed to delete message from database:', error)
    throw error
  }
}

// ==================== US-010: Session Management ====================

/**
 * Create a new session
 */
export async function createSession({
  sessionId,
  userId,
  expiresAt,
}: {
  sessionId: string
  userId: string
  expiresAt: Date
}): Promise<Session[]> {
  try {
    return await db
      .insert(sessions)
      .values({
        id: sessionId,
        user_id: userId,
        expires_at: expiresAt,
      })
      .returning()
  } catch (error) {
    console.error('Failed to create session in database:', error)
    throw error
  }
}

/**
 * Get a session by ID
 */
export async function getSession(
  sessionId: string
): Promise<Session | undefined> {
  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
    return session
  } catch (error) {
    console.error('Failed to get session from database:', error)
    throw error
  }
}

/**
 * Update session activity timestamp
 */
export async function updateSessionActivity(
  sessionId: string
): Promise<void> {
  try {
    await db
      .update(sessions)
      .set({ last_activity: new Date() })
      .where(eq(sessions.id, sessionId))
  } catch (error) {
    console.error('Failed to update session activity in database:', error)
    throw error
  }
}

/**
 * Delete a session (for logout)
 */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await db.delete(sessions).where(eq(sessions.id, sessionId))
  } catch (error) {
    console.error('Failed to delete session from database:', error)
    throw error
  }
}

/**
 * Delete all sessions for a user
 */
export async function deleteUserSessions(userId: string): Promise<void> {
  try {
    await db.delete(sessions).where(eq(sessions.user_id, userId))
  } catch (error) {
    console.error('Failed to delete user sessions from database:', error)
    throw error
  }
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  try {
    const result = await db
      .delete(sessions)
      .where(lt(sessions.expires_at, new Date()))
    return (result as any).rowCount || 0
  } catch (error) {
    console.error('Failed to cleanup expired sessions:', error)
    return 0
  }
}

// ==================== Epic 3: Design Tokens Management ====================

/**
 * Create a new design token set (US-024, US-025)
 */
export async function createDesignToken({
  userId,
  name,
  tokens,
  version,
  isActive = false,
}: {
  userId: string
  name: string
  tokens: any
  version: string
  isActive?: boolean
}): Promise<DesignToken[]> {
  try {
    // If this is being set as active, deactivate all other tokens for this user
    if (isActive) {
      await db
        .update(design_tokens)
        .set({ is_active: false })
        .where(eq(design_tokens.user_id, userId))
    }

    return await db
      .insert(design_tokens)
      .values({
        user_id: userId,
        name,
        tokens,
        version,
        is_active: isActive,
      })
      .returning()
  } catch (error) {
    console.error('Failed to create design token in database:', error)
    throw error
  }
}

/**
 * Get design token by ID
 */
export async function getDesignToken(tokenId: string): Promise<DesignToken | undefined> {
  try {
    const [token] = await db
      .select()
      .from(design_tokens)
      .where(eq(design_tokens.id, tokenId))
    return token
  } catch (error) {
    console.error('Failed to get design token from database:', error)
    throw error
  }
}

/**
 * Get all design tokens for a user (US-025)
 */
export async function getDesignTokensByUserId(userId: string): Promise<DesignToken[]> {
  try {
    return await db
      .select()
      .from(design_tokens)
      .where(eq(design_tokens.user_id, userId))
      .orderBy(desc(design_tokens.created_at))
  } catch (error) {
    console.error('Failed to get design tokens by user from database:', error)
    throw error
  }
}

/**
 * Get all versions of a specific design token (US-025)
 */
export async function getDesignTokenVersions({
  userId,
  name,
}: {
  userId: string
  name: string
}): Promise<DesignToken[]> {
  try {
    return await db
      .select()
      .from(design_tokens)
      .where(and(eq(design_tokens.user_id, userId), eq(design_tokens.name, name)))
      .orderBy(desc(design_tokens.version))
  } catch (error) {
    console.error('Failed to get design token versions from database:', error)
    throw error
  }
}

/**
 * Get active design token for a user
 */
export async function getActiveDesignToken(userId: string): Promise<DesignToken | undefined> {
  try {
    const [token] = await db
      .select()
      .from(design_tokens)
      .where(and(eq(design_tokens.user_id, userId), eq(design_tokens.is_active, true)))
    return token
  } catch (error) {
    console.error('Failed to get active design token from database:', error)
    throw error
  }
}

/**
 * Set a design token as active
 */
export async function setActiveDesignToken({
  userId,
  tokenId,
}: {
  userId: string
  tokenId: string
}): Promise<DesignToken[]> {
  try {
    // Deactivate all tokens for this user
    await db
      .update(design_tokens)
      .set({ is_active: false })
      .where(eq(design_tokens.user_id, userId))

    // Activate the specified token
    return await db
      .update(design_tokens)
      .set({ is_active: true, updated_at: new Date() })
      .where(and(eq(design_tokens.id, tokenId), eq(design_tokens.user_id, userId)))
      .returning()
  } catch (error) {
    console.error('Failed to set active design token in database:', error)
    throw error
  }
}

/**
 * Update design token
 */
export async function updateDesignToken({
  tokenId,
  userId,
  tokens,
}: {
  tokenId: string
  userId: string
  tokens: any
}): Promise<DesignToken[]> {
  try {
    return await db
      .update(design_tokens)
      .set({ tokens, updated_at: new Date() })
      .where(and(eq(design_tokens.id, tokenId), eq(design_tokens.user_id, userId)))
      .returning()
  } catch (error) {
    console.error('Failed to update design token in database:', error)
    throw error
  }
}

/**
 * Delete a design token
 */
export async function deleteDesignToken({
  tokenId,
  userId,
}: {
  tokenId: string
  userId: string
}): Promise<void> {
  try {
    await db
      .delete(design_tokens)
      .where(and(eq(design_tokens.id, tokenId), eq(design_tokens.user_id, userId)))
  } catch (error) {
    console.error('Failed to delete design token from database:', error)
    throw error
  }
}

/**
 * Create a generation with design token tracking (US-025)
 */
export async function createGeneration({
  chatId,
  userId,
  prompt,
  generatedCode,
  promptVersionId,
  designTokensVersionId,
  model,
  templateUsed,
  generationTimeMs,
}: {
  chatId: string
  userId: string
  prompt: string
  generatedCode: string
  promptVersionId?: string
  designTokensVersionId?: string
  model: string
  templateUsed?: string
  generationTimeMs: number
}): Promise<Generation[]> {
  try {
    return await db
      .insert(generations)
      .values({
        chat_id: chatId,
        user_id: userId,
        prompt,
        generated_code: generatedCode,
        prompt_version_id: promptVersionId,
        design_tokens_version_id: designTokensVersionId,
        model,
        template_used: templateUsed,
        generation_time_ms: generationTimeMs,
      })
      .returning()
  } catch (error) {
    console.error('Failed to create generation in database:', error)
    throw error
  }
}

/**
 * Get generations by design token version
 */
export async function getGenerationsByDesignToken(
  designTokensVersionId: string
): Promise<Generation[]> {
  try {
    return await db
      .select()
      .from(generations)
      .where(eq(generations.design_tokens_version_id, designTokensVersionId))
      .orderBy(desc(generations.created_at))
  } catch (error) {
    console.error('Failed to get generations by design token from database:', error)
    throw error
  }
}
