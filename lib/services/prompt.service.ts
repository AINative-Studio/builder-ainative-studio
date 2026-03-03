import { eq, and, desc } from 'drizzle-orm'
import db from '@/lib/db/connection'
import { prompt_versions } from '@/lib/db/schema'

export interface CreatePromptData {
  type: string
  version: string
  content: string
  metadata?: Record<string, any>
  abTestPercentage?: number
}

export interface UpdatePromptData {
  content?: string
  metadata?: Record<string, any>
  abTestPercentage?: number
}

// Get all prompt versions
export async function getAllPrompts() {
  if (!db) {
    throw new Error('Database not available')
  }

  return await db
    .select()
    .from(prompt_versions)
    .orderBy(desc(prompt_versions.created_at))
}

// Get prompt by ID
export async function getPromptById(id: string) {
  if (!db) {
    throw new Error('Database not available')
  }

  const result = await db
    .select()
    .from(prompt_versions)
    .where(eq(prompt_versions.id, id))
    .limit(1)

  if (result.length === 0) {
    throw new Error('Prompt not found')
  }

  return result[0]
}

// Create new prompt version
export async function createPrompt(data: CreatePromptData) {
  if (!db) {
    throw new Error('Database not available')
  }

  const [result] = await db
    .insert(prompt_versions)
    .values({
      type: data.type,
      version: data.version,
      content: data.content,
      metadata: data.metadata || null,
      is_active: false,
      ab_test_percentage: data.abTestPercentage || 0,
    })
    .returning()

  return result
}

// Update prompt version
export async function updatePrompt(id: string, data: UpdatePromptData) {
  if (!db) {
    throw new Error('Database not available')
  }

  // Check if prompt exists
  await getPromptById(id)

  const updateData: any = {}
  if (data.content !== undefined) updateData.content = data.content
  if (data.metadata !== undefined) updateData.metadata = data.metadata
  if (data.abTestPercentage !== undefined)
    updateData.ab_test_percentage = data.abTestPercentage

  const [result] = await db
    .update(prompt_versions)
    .set(updateData)
    .where(eq(prompt_versions.id, id))
    .returning()

  return result
}

// Activate a prompt version (deactivates others of same type)
export async function activatePrompt(id: string) {
  if (!db) {
    throw new Error('Database not available')
  }

  // Get the prompt to activate
  const prompt = await getPromptById(id)

  // Start a transaction to ensure atomicity
  // First, deactivate all prompts of the same type
  await db
    .update(prompt_versions)
    .set({ is_active: false })
    .where(eq(prompt_versions.type, prompt.type))

  // Then activate the selected prompt
  const [result] = await db
    .update(prompt_versions)
    .set({ is_active: true })
    .where(eq(prompt_versions.id, id))
    .returning()

  return result
}

// Get active prompt(s) for a type
export async function getActivePrompts(type: string) {
  if (!db) {
    throw new Error('Database not available')
  }

  return await db
    .select()
    .from(prompt_versions)
    .where(
      and(eq(prompt_versions.type, type), eq(prompt_versions.is_active, true)),
    )
}

// Deactivate a prompt
export async function deactivatePrompt(id: string) {
  if (!db) {
    throw new Error('Database not available')
  }

  const [result] = await db
    .update(prompt_versions)
    .set({ is_active: false })
    .where(eq(prompt_versions.id, id))
    .returning()

  return result
}
