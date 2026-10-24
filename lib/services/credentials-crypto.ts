/**
 * Pure AES-256-GCM token encryption, deliberately split out of
 * lib/services/credentials.service.ts (#1489).
 *
 * These three functions use nothing but Node's `crypto` and
 * process.env.DEPLOYMENT_ENCRYPTION_KEY — no database, no logger, no I/O.
 * But credentials.service.ts statically imports the whole drizzle chain
 * (`@/lib/db`, `@/lib/db/schema`, `drizzle-orm`) for its *other* exports
 * (saveCredentials/getCredentials/...), so every module that wanted only
 * encryptToken/decryptToken paid for Vite resolving and transforming
 * `drizzle-orm/postgres-js` plus the 1300-line schema at import time.
 *
 * Measured on the #1489 repro, that chain cost ~3.5s to import, and it was
 * reached from app/api/build/ask/route.ts via:
 *
 *   route.ts -> lib/build/ask-tools.ts
 *            -> lib/build/company-zerodb-credentials.ts
 *            -> lib/services/credentials.service.ts  (the DB chain)
 *
 * which is what made __tests__/api/build-ask-project-resolution.test.ts take
 * ~4s and intermittently blow its 5000ms timeout under full-suite contention.
 *
 * This mirrors the fix already applied in lib/build/phone.ts (toE164 extracted
 * out of lib/build/otp.ts for the same reason): the only reliable way to stop
 * paying for a heavy dependency graph is for the caller to not import anything
 * that can reach it. credentials.service.ts re-exports from here, so its own
 * API is unchanged.
 *
 * NOTE: the `🗄️  Using PostgreSQL database` line that appears in test stdout is
 * NOT a real connection — `postgres(url)` only builds a client object and
 * connects lazily on first query. Deleting POSTGRES_URL left the import time
 * unchanged. The cost was always module transform, never network I/O.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Encrypted credential data structure
 */
export interface EncryptedCredential {
  encryptedToken: string
  iv: string
  authTag: string
}

/**
 * Get encryption key from environment variable
 * @throws Error if DEPLOYMENT_ENCRYPTION_KEY is not set
 */
export function getEncryptionKey(): Buffer {
  const key = process.env.DEPLOYMENT_ENCRYPTION_KEY

  if (!key) {
    throw new Error('DEPLOYMENT_ENCRYPTION_KEY environment variable is not set')
  }

  // Key should be 32 bytes (256 bits) in hex format
  if (key.length !== 64) {
    throw new Error('DEPLOYMENT_ENCRYPTION_KEY must be 32 bytes (64 hex characters)')
  }

  return Buffer.from(key, 'hex')
}

/**
 * Encrypt a token using AES-256-GCM
 * @param token - Plain text token to encrypt
 * @returns Encrypted token with IV and auth tag
 */
export function encryptToken(token: string): EncryptedCredential {
  const key = getEncryptionKey()
  const iv = randomBytes(16) // 128-bit IV for GCM mode

  const cipher = createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(token, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return {
    encryptedToken: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  }
}

/**
 * Decrypt a token using AES-256-GCM
 * @param encryptedData - Encrypted credential data
 * @returns Decrypted plain text token
 * @throws Error if authentication fails
 */
export function decryptToken(encryptedData: EncryptedCredential): string {
  const key = getEncryptionKey()
  const iv = Buffer.from(encryptedData.iv, 'hex')
  const authTag = Buffer.from(encryptedData.authTag, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedData.encryptedToken, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
