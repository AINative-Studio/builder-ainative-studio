import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1465 — signInAction() used to map every AuthError to the same generic
 * "Invalid credentials. Please try again." whether the user mistyped their
 * password or AINative's own backend was down. This asserts the two cases
 * now produce distinct, honest messages.
 *
 * next-auth itself can't be imported in vitest's node environment here (see
 * ainative-login-failure-classification-1465.test.ts's header comment —
 * next-auth/lib/env.js does a bare `next/server` import Node's resolver
 * can't satisfy under this pnpm layout, pre-existing and unrelated to this
 * fix), so 'next-auth' is mocked with a fake AuthError base class, and
 * '@/app/(auth)/auth' is mocked with a fake AINativeBackendUnavailable that
 * extends it — mirroring the real `class AINativeBackendUnavailable extends
 * AuthError` in app/(auth)/auth.ts and the `instanceof` check signInAction()
 * actually does (NOT a switch on error.type, whose declared type is
 * next-auth's own closed ErrorType union).
 */

class FakeAuthError extends Error {
  type: string
  constructor(type: string, message?: string) {
    super(message)
    this.type = type
    this.name = 'AuthError'
  }
}

class FakeAINativeBackendUnavailable extends FakeAuthError {
  constructor() {
    super('AINativeBackendUnavailable')
  }
}

vi.mock('next-auth', () => ({ AuthError: FakeAuthError }))

const signInMock = vi.fn()
vi.mock('@/app/(auth)/auth', () => ({
  signIn: signInMock,
  signOut: vi.fn(),
  AINativeBackendUnavailable: FakeAINativeBackendUnavailable,
}))

vi.mock('@/lib/db/queries', () => ({ createUser: vi.fn(), getUser: vi.fn(async () => []) }))
vi.mock('@/lib/turnstile', () => ({ turnstileEnabled: () => false, verifyTurnstileToken: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Map()) }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

function formData(email: string, password: string) {
  const fd = new FormData()
  fd.set('email', email)
  fd.set('password', password)
  return fd
}

beforeEach(() => {
  signInMock.mockReset()
})

describe('#1465 signInAction — distinct messages for wrong credentials vs backend outage', () => {
  it('wrong credentials (CredentialsSignin) → "Invalid credentials. Please try again."', async () => {
    signInMock.mockRejectedValueOnce(new FakeAuthError('CredentialsSignin'))
    const { signInAction } = await import('@/app/(auth)/actions')

    const result = await signInAction(undefined, formData('founder@example.com', 'wrong-password'))

    expect(result).toEqual({ type: 'error', message: 'Invalid credentials. Please try again.' })
  })

  it('AINative backend unavailable → a distinct, honest message (not "Invalid credentials")', async () => {
    signInMock.mockRejectedValueOnce(new FakeAINativeBackendUnavailable())
    const { signInAction } = await import('@/app/(auth)/actions')

    const result = await signInAction(undefined, formData('founder@example.com', 'correct-password'))

    expect(result?.type).toBe('error')
    // Must differ from BOTH the wrong-credentials message and the generic
    // catch-all fallback — a distinct, honest, backend-outage-specific message.
    expect(result?.message).not.toBe('Invalid credentials. Please try again.')
    expect(result?.message).not.toBe('Something went wrong. Please try again.')
    expect(result?.message.toLowerCase()).toMatch(/couldn.?t reach|try again in a moment|unavailable/)
  })

  it('an unrecognized AuthError type still falls back to the generic "Something went wrong" message', async () => {
    signInMock.mockRejectedValueOnce(new FakeAuthError('SomeOtherAuthError'))
    const { signInAction } = await import('@/app/(auth)/actions')

    const result = await signInAction(undefined, formData('founder@example.com', 'correct-password'))

    expect(result).toEqual({ type: 'error', message: 'Something went wrong. Please try again.' })
  })
})
