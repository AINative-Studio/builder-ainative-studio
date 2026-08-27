/**
 * Map an OAuth callback ?error= code to a friendly, recoverable message (#294).
 * Returns null for missing/unknown non-ainative codes so we don't surface noise.
 */
export function messageForOAuthError(code: string | undefined | null): string | null {
  if (!code) return null
  switch (code) {
    case 'ainative_exchange_failed':
      return 'AINative sign-in hit a temporary issue. Please try again — this usually works on a second attempt.'
    case 'ainative_invalid_state':
    case 'ainative_state_mismatch':
      return 'Your sign-in link expired. Please start again.'
    case 'ainative_access_denied':
      return 'Sign-in was cancelled. Try again when you’re ready.'
    default:
      if (code.startsWith('ainative_')) {
        return 'AINative sign-in didn’t complete. Please try again.'
      }
      return null
  }
}
