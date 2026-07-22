'use client'

/**
 * "Sign in with AINative" button — kicks off the OAuth2.1/PKCE flow by
 * navigating to the server route that redirects to core's /oauth/authorize.
 */
export function AINativeOAuthButton({ label = 'Sign in with AINative' }: { label?: string }) {
  return (
    <a
      href="/api/auth/ainative/authorize"
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      <span
        aria-hidden
        className="inline-block h-4 w-4 rounded-sm bg-gradient-to-br from-indigo-500 to-fuchsia-500"
      />
      {label}
    </a>
  )
}
