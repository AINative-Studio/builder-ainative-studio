import { describe, it, expect } from 'vitest'
import { compareSync } from 'bcrypt-ts'
import { generateHashedPassword } from '@/lib/db/utils'

describe('generateHashedPassword', () => {
  it('returns a bcrypt hash that verifies against the original plaintext', () => {
    const hash = generateHashedPassword('correct-horse-battery-staple')
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
    // bcrypt hashes start with $2a$, $2b$ or $2y$ followed by the cost factor
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/)
    expect(compareSync('correct-horse-battery-staple', hash)).toBe(true)
  })

  it('does not verify against a different plaintext', () => {
    const hash = generateHashedPassword('correct-horse-battery-staple')
    expect(compareSync('wrong-password', hash)).toBe(false)
  })

  it('uses a random salt, so hashing the same input twice yields different hashes', () => {
    const hashA = generateHashedPassword('same-password')
    const hashB = generateHashedPassword('same-password')
    expect(hashA).not.toBe(hashB)
    // Both still verify against the original plaintext
    expect(compareSync('same-password', hashA)).toBe(true)
    expect(compareSync('same-password', hashB)).toBe(true)
  })

  it('handles an empty-string password without throwing', () => {
    expect(() => generateHashedPassword('')).not.toThrow()
    const hash = generateHashedPassword('')
    expect(compareSync('', hash)).toBe(true)
  })

  it('handles long/unicode passwords', () => {
    const longPassword = `${'a'.repeat(100)}-🔒-пароль`
    const hash = generateHashedPassword(longPassword)
    expect(compareSync(longPassword, hash)).toBe(true)
  })
})
