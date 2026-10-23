export interface MissingEnvVar {
  name: string
  description: string
  example: string
  required: boolean
}

export function checkRequiredEnvVars(): MissingEnvVar[] {
  const requiredVars: MissingEnvVar[] = [
    {
      name: 'META_API_KEY',
      description: 'Your Meta LLAMA API key for generating apps',
      example: 'LLM|...',
      required: true,
    },
    {
      name: 'AUTH_SECRET',
      description: 'Secret key for NextAuth.js and JWT authentication',
      example: 'your-secret-key-here (generate with: openssl rand -base64 32)',
      required: true,
    },
    {
      name: 'POSTGRES_URL',
      description: 'PostgreSQL database connection string',
      example: 'postgresql://user:password@localhost:5432/database',
      required: true,
    },
    {
      name: 'REDIS_URL',
      description: 'Redis connection URL for state persistence',
      example: 'redis://localhost:6379',
      required: true,
    },
  ]

  const missing = requiredVars.filter((envVar) => {
    const value = process.env[envVar.name]
    return !value || value.trim() === ''
  })

  return missing
}

export function hasAllRequiredEnvVars(): boolean {
  return checkRequiredEnvVars().length === 0
}

export const hasEnvVars = !!(
  process.env.META_API_KEY &&
  process.env.AUTH_SECRET &&
  process.env.POSTGRES_URL &&
  process.env.REDIS_URL
)

/**
 * #1194 — a missing AUTH_SECRET must hard-fail at startup in production,
 * never silently run on a derived, guessable secret. `app/(auth)/auth.ts`
 * used to hash ANTHROPIC_API_KEY/AINATIVE_API_TOKEN/DATABASE_URL (or a
 * hardcoded literal if none of those were set either) into AUTH_SECRET with
 * a trivial 32-bit string hash on every missing-secret case, production
 * included — predictable enough, and built from values that may be shared
 * across environments or otherwise guessable, to let someone forge a session
 * token.
 *
 * Extracted as a pure function (rather than left as module-level code
 * directly in auth.ts) so it's testable without pulling in NextAuth/DB
 * query imports just to exercise a startup guard. `auth.ts` calls this
 * before its own derived-fallback branch runs.
 *
 * `nodeEnv` is an explicit parameter (not read from process.env internally)
 * so a test can exercise both branches deterministically without mutating
 * global process.env state.
 */
export function assertAuthSecretOrThrow(nodeEnv: string | undefined, authSecret: string | undefined): void {
  if (authSecret) return
  if (nodeEnv === 'production') {
    throw new Error(
      '[auth] AUTH_SECRET is not set. Refusing to start in production with no session-signing secret ' +
      '— generate one with `openssl rand -base64 32` and set it as the AUTH_SECRET environment variable.',
    )
  }
}
