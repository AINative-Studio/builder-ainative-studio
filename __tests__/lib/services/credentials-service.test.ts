import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'

/**
 * Unit tests for the deployment credentials service (US-071): AES-256-GCM
 * encryption/decryption (real crypto, no mocking needed — it's pure Node
 * stdlib) plus the drizzle-backed CRUD paths, mocked at `@/lib/db`.
 */

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({ deployment_credentials: {} }))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
  and: vi.fn((...args) => ({ op: 'and', args })),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

function selectChain(rows: any[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }
}
function selectChainNoLimit(rows: any[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) }
}
function insertChain(row: any) {
  return { values: () => ({ returning: () => Promise.resolve([row]) }) }
}
function updateChain() {
  return { set: () => ({ where: () => Promise.resolve(undefined) }) }
}
function deleteChain(rows: any[]) {
  return { where: () => ({ returning: () => Promise.resolve(rows) }) }
}

const VALID_KEY = randomBytes(32).toString('hex')

describe('encryptToken / decryptToken', () => {
  const originalKey = process.env.DEPLOYMENT_ENCRYPTION_KEY

  afterEach(() => {
    process.env.DEPLOYMENT_ENCRYPTION_KEY = originalKey
  })

  it('throws when DEPLOYMENT_ENCRYPTION_KEY is not set', async () => {
    delete process.env.DEPLOYMENT_ENCRYPTION_KEY
    const { encryptToken } = await import('@/lib/services/credentials.service')

    expect(() => encryptToken('secret')).toThrow(
      'DEPLOYMENT_ENCRYPTION_KEY environment variable is not set'
    )
  })

  it('throws when the key is not 64 hex characters', async () => {
    process.env.DEPLOYMENT_ENCRYPTION_KEY = 'tooshort'
    const { encryptToken } = await import('@/lib/services/credentials.service')

    expect(() => encryptToken('secret')).toThrow(
      'DEPLOYMENT_ENCRYPTION_KEY must be 32 bytes (64 hex characters)'
    )
  })

  it('round-trips a token through encrypt then decrypt', async () => {
    process.env.DEPLOYMENT_ENCRYPTION_KEY = VALID_KEY
    const { encryptToken, decryptToken } = await import('@/lib/services/credentials.service')

    const encrypted = encryptToken('my-secret-api-token')
    expect(encrypted.encryptedToken).toBeTruthy()
    expect(encrypted.iv).toHaveLength(32) // 16 bytes hex-encoded
    expect(encrypted.authTag).toBeTruthy()

    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe('my-secret-api-token')
  })

  it('produces a different ciphertext (and IV) for the same plaintext on repeat calls', async () => {
    process.env.DEPLOYMENT_ENCRYPTION_KEY = VALID_KEY
    const { encryptToken } = await import('@/lib/services/credentials.service')

    const first = encryptToken('same-token')
    const second = encryptToken('same-token')

    expect(first.iv).not.toBe(second.iv)
    expect(first.encryptedToken).not.toBe(second.encryptedToken)
  })

  it('throws on tampered auth tag (authentication failure)', async () => {
    process.env.DEPLOYMENT_ENCRYPTION_KEY = VALID_KEY
    const { encryptToken, decryptToken } = await import('@/lib/services/credentials.service')

    const encrypted = encryptToken('secret-value')
    const tampered = { ...encrypted, authTag: encrypted.authTag.replace(/^./, encrypted.authTag[0] === 'a' ? 'b' : 'a') }

    expect(() => decryptToken(tampered)).toThrow()
  })
})

describe('saveCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_ENCRYPTION_KEY = VALID_KEY
  })

  it('inserts a new credential row when none exists', async () => {
    dbMock.select.mockReturnValue(selectChain([]))
    dbMock.insert.mockReturnValue(insertChain({ id: 'cred-1' }))

    const { saveCredentials } = await import('@/lib/services/credentials.service')
    const id = await saveCredentials('user-1', 'vercel', 'token-abc')

    expect(id).toBe('cred-1')
    expect(dbMock.insert).toHaveBeenCalled()
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  it('updates the existing credential row when one already exists', async () => {
    dbMock.select.mockReturnValue(selectChain([{ id: 'cred-existing' }]))
    dbMock.update.mockReturnValue(updateChain())

    const { saveCredentials } = await import('@/lib/services/credentials.service')
    const id = await saveCredentials('user-1', 'netlify', 'token-xyz')

    expect(id).toBe('cred-existing')
    expect(dbMock.update).toHaveBeenCalled()
    expect(dbMock.insert).not.toHaveBeenCalled()
  })
})

describe('getCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_ENCRYPTION_KEY = VALID_KEY
  })

  it('returns null when no credentials are stored', async () => {
    dbMock.select.mockReturnValue(selectChain([]))
    const { getCredentials } = await import('@/lib/services/credentials.service')

    const result = await getCredentials('user-1', 'railway')
    expect(result).toBeNull()
  })

  it('returns the decrypted token when a stored record round-trips correctly', async () => {
    const { encryptToken } = await import('@/lib/services/credentials.service')
    const encrypted = encryptToken('plaintext-token')

    dbMock.select.mockReturnValue(
      selectChain([
        {
          id: 'cred-1',
          encrypted_token: encrypted.encryptedToken,
          iv: encrypted.iv,
          auth_tag: encrypted.authTag,
        },
      ])
    )

    const { getCredentials } = await import('@/lib/services/credentials.service')
    const result = await getCredentials('user-1', 'railway')

    expect(result).toBe('plaintext-token')
  })

  it('throws a generic error (without leaking details) when decryption fails', async () => {
    dbMock.select.mockReturnValue(
      selectChain([
        { id: 'cred-1', encrypted_token: 'corrupt', iv: '00'.repeat(16), auth_tag: '00'.repeat(16) },
      ])
    )

    const { getCredentials } = await import('@/lib/services/credentials.service')

    await expect(getCredentials('user-1', 'railway')).rejects.toThrow(
      'Failed to decrypt credentials'
    )
  })
})

describe('deleteCredentials', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when a row was deleted', async () => {
    dbMock.delete.mockReturnValue(deleteChain([{ id: 'cred-1' }]))
    const { deleteCredentials } = await import('@/lib/services/credentials.service')

    expect(await deleteCredentials('user-1', 'vercel')).toBe(true)
  })

  it('returns false when nothing matched', async () => {
    dbMock.delete.mockReturnValue(deleteChain([]))
    const { deleteCredentials } = await import('@/lib/services/credentials.service')

    expect(await deleteCredentials('user-1', 'vercel')).toBe(false)
  })
})

describe('listCredentialPlatforms', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the list of platforms for a user', async () => {
    dbMock.select.mockReturnValue(selectChainNoLimit([{ platform: 'vercel' }, { platform: 'railway' }]))
    const { listCredentialPlatforms } = await import('@/lib/services/credentials.service')

    const result = await listCredentialPlatforms('user-1')
    expect(result).toEqual(['vercel', 'railway'])
  })

  it('returns an empty array when the underlying query throws (table missing)', async () => {
    dbMock.select.mockImplementation(() => {
      throw new Error('relation "deployment_credentials" does not exist')
    })
    const { listCredentialPlatforms } = await import('@/lib/services/credentials.service')

    const result = await listCredentialPlatforms('user-1')
    expect(result).toEqual([])
  })
})

describe('hasCredentials', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when a credential row exists', async () => {
    dbMock.select.mockReturnValue(selectChain([{ id: 'cred-1' }]))
    const { hasCredentials } = await import('@/lib/services/credentials.service')

    expect(await hasCredentials('user-1', 'vercel')).toBe(true)
  })

  it('returns false when no credential row exists', async () => {
    dbMock.select.mockReturnValue(selectChain([]))
    const { hasCredentials } = await import('@/lib/services/credentials.service')

    expect(await hasCredentials('user-1', 'vercel')).toBe(false)
  })
})

describe('getCredentialsWithFallback', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_ENCRYPTION_KEY = VALID_KEY
  })

  it('returns the stored user token when present, without consulting the env var', async () => {
    const { encryptToken } = await import('@/lib/services/credentials.service')
    const encrypted = encryptToken('user-stored-token')
    dbMock.select.mockReturnValue(
      selectChain([{ id: 'c1', encrypted_token: encrypted.encryptedToken, iv: encrypted.iv, auth_tag: encrypted.authTag }])
    )
    process.env.MY_FALLBACK_VAR = 'should-not-be-used'

    const { getCredentialsWithFallback } = await import('@/lib/services/credentials.service')
    const result = await getCredentialsWithFallback('user-1', 'vercel', 'MY_FALLBACK_VAR')

    expect(result).toBe('user-stored-token')
  })

  it('falls back to the environment variable when no stored token exists', async () => {
    dbMock.select.mockReturnValue(selectChain([]))
    process.env.MY_FALLBACK_VAR = 'env-fallback-token'

    const { getCredentialsWithFallback } = await import('@/lib/services/credentials.service')
    const result = await getCredentialsWithFallback('user-1', 'vercel', 'MY_FALLBACK_VAR')

    expect(result).toBe('env-fallback-token')
  })

  it('returns null when neither a stored token nor the env var is present', async () => {
    dbMock.select.mockReturnValue(selectChain([]))
    delete process.env.MY_FALLBACK_VAR

    const { getCredentialsWithFallback } = await import('@/lib/services/credentials.service')
    const result = await getCredentialsWithFallback('user-1', 'vercel', 'MY_FALLBACK_VAR')

    expect(result).toBeNull()
  })
})
