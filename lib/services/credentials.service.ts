// @ts-nocheck
/**
 * Credentials Service (US-071)
 *
 * Securely manages deployment credentials with AES-256-GCM encryption.
 *
 * Security features:
 * - AES-256-GCM authenticated encryption
 * - Unique IV per encryption operation
 * - Authentication tag verification
 * - Constant-time comparison for sensitive operations
 * - Credentials scoped per user per platform
 */

import { db } from '@/lib/db'
import { deployment_credentials } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { timingSafeEqual } from 'crypto'
import { logger } from '@/lib/logger'
import {
  encryptToken,
  decryptToken,
  type EncryptedCredential,
} from '@/lib/services/credentials-crypto'

/**
 * The pure AES-256-GCM helpers now live in ./credentials-crypto so that
 * callers wanting only encryption do not transitively import this module's
 * drizzle/Postgres chain (#1489). Re-exported here so this module's public
 * API is unchanged for existing importers and tests.
 */
export {
  encryptToken,
  decryptToken,
  type EncryptedCredential,
} from '@/lib/services/credentials-crypto'

/**
 * Supported deployment platforms
 */
export type Platform = 'vercel' | 'netlify' | 'railway' | 'ainative-cloud'

/**
 * Credential record from database
 */
interface CredentialRecord {
  id: string
  userId: string
  platform: string
  encrypted_token: string
  iv: string
  auth_tag: string
  created_at: Date
  updated_at: Date
}

/**
 * Save or update deployment credentials for a user and platform
 * @param userId - User ID
 * @param platform - Deployment platform
 * @param token - API token to store (will be encrypted)
 * @returns Created/updated credential ID
 */
export async function saveCredentials(
  userId: string,
  platform: Platform,
  token: string
): Promise<string> {
  const { encryptedToken, iv, authTag } = encryptToken(token)

  // Check if credentials already exist for this user and platform
  const existing = await db
    .select()
    .from(deployment_credentials)
    .where(
      and(
        eq(deployment_credentials.user_id, userId),
        eq(deployment_credentials.platform, platform)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    // Update existing credentials
    await db
      .update(deployment_credentials)
      .set({
        encrypted_token: encryptedToken,
        iv,
        auth_tag: authTag,
        updated_at: new Date(),
      })
      .where(eq(deployment_credentials.id, existing[0].id))

    return existing[0].id
  } else {
    // Insert new credentials
    const result = await db
      .insert(deployment_credentials)
      .values({
        user_id: userId,
        platform,
        encrypted_token: encryptedToken,
        iv,
        auth_tag: authTag,
      })
      .returning({ id: deployment_credentials.id })

    return result[0].id
  }
}

/**
 * Get decrypted credentials for a user and platform
 * @param userId - User ID
 * @param platform - Deployment platform
 * @returns Decrypted token or null if not found
 */
export async function getCredentials(
  userId: string,
  platform: Platform
): Promise<string | null> {
  const result = await db
    .select()
    .from(deployment_credentials)
    .where(
      and(
        eq(deployment_credentials.user_id, userId),
        eq(deployment_credentials.platform, platform)
      )
    )
    .limit(1)

  if (result.length === 0) {
    return null
  }

  const record = result[0]

  try {
    return decryptToken({
      encryptedToken: record.encrypted_token,
      iv: record.iv,
      authTag: record.auth_tag,
    })
  } catch (error) {
    // Log error but don't expose details
    console.error('Failed to decrypt credentials:', error)
    throw new Error('Failed to decrypt credentials')
  }
}

/**
 * Delete credentials for a user and platform
 * @param userId - User ID
 * @param platform - Deployment platform
 * @returns True if deleted, false if not found
 */
export async function deleteCredentials(
  userId: string,
  platform: Platform
): Promise<boolean> {
  const result = await db
    .delete(deployment_credentials)
    .where(
      and(
        eq(deployment_credentials.user_id, userId),
        eq(deployment_credentials.platform, platform)
      )
    )
    .returning({ id: deployment_credentials.id })

  return result.length > 0
}

/**
 * Get all platforms for which user has saved credentials
 * @param userId - User ID
 * @returns Array of platforms with credentials
 */
export async function listCredentialPlatforms(userId: string): Promise<Platform[]> {
  try {
    const result = await db
      .select({ platform: deployment_credentials.platform })
      .from(deployment_credentials)
      .where(eq(deployment_credentials.user_id, userId))

    return result.map(r => r.platform as Platform)
  } catch (error) {
    // Table doesn't exist in AINative database - return empty array
    console.warn('deployment_credentials table not found, returning empty platforms list', { userId, error })
    return []
  }
}

/**
 * Verify if credentials exist for a user and platform
 * @param userId - User ID
 * @param platform - Deployment platform
 * @returns True if credentials exist
 */
export async function hasCredentials(
  userId: string,
  platform: Platform
): Promise<boolean> {
  const result = await db
    .select({ id: deployment_credentials.id })
    .from(deployment_credentials)
    .where(
      and(
        eq(deployment_credentials.user_id, userId),
        eq(deployment_credentials.platform, platform)
      )
    )
    .limit(1)

  return result.length > 0
}

/**
 * Get credentials with fallback to environment variable
 * Useful for testing or default credentials
 * @param userId - User ID
 * @param platform - Deployment platform
 * @param envVarName - Environment variable name to check as fallback
 * @returns Decrypted token or null
 */
export async function getCredentialsWithFallback(
  userId: string,
  platform: Platform,
  envVarName: string
): Promise<string | null> {
  // First try to get user's stored credentials
  const userToken = await getCredentials(userId, platform)
  if (userToken) {
    return userToken
  }

  // Fallback to environment variable
  return process.env[envVarName] || null
}
