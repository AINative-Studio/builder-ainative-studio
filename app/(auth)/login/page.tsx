import { redirect } from 'next/navigation'
import { auth } from '../auth'
import { AuthForm } from '@/components/auth-form'
import { AINativeOAuthButton } from '@/components/ainative-oauth-button'
import { isOAuthConfigured } from '@/lib/auth/ainative-oauth'
import { messageForOAuthError } from '@/lib/auth/oauth-error-messages'

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>
}) {
  const session = await auth()

  if (session) {
    redirect('/')
  }

  const oauthEnabled = isOAuthConfigured()
  const params = (await searchParams) || {}
  const errorMessage = messageForOAuthError(params.error)

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border shadow-xl">
        <div className="flex flex-col items-center justify-center space-y-3 border-b border-border bg-background px-4 py-6 pt-8 text-center sm:px-16">
          <h3 className="text-xl font-semibold text-foreground">Sign In</h3>
          <p className="text-sm text-muted-foreground">
            {oauthEnabled
              ? 'Continue with your AINative account, or use email and password'
              : 'Use your email and password to sign in'}
          </p>
        </div>
        <div className="flex flex-col space-y-4 bg-muted/50 px-4 py-8 sm:px-16">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
            >
              {errorMessage}
            </div>
          )}
          {oauthEnabled && (
            <>
              <AINativeOAuthButton />
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}
          <AuthForm type="signin" />
        </div>
      </div>
    </div>
  )
}
