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
