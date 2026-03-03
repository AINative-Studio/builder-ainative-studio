export const DUMMY_PASSWORD =
  '$2b$10$k7L3lUJhDLKBGbz4Yf8ZJe9Yk6j5Qz1Xr2Wv8Ts7Nq9Mp3Lk4Jh6Fg'

export const guestRegex = /^guest-[a-zA-Z0-9_-]+@example\.com$/

export const isDevelopmentEnvironment = process.env.NODE_ENV === 'development'

export const DEPLOY_URL =
  'https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAINative-Studio%2Fbuilder-ainative-studio&env=DATABASE_URL,AUTH_SECRET,ANTHROPIC_API_KEY&envDescription=Required+environment+variables&envLink=https%3A%2F%2Fgithub.com%2FAINative-Studio%2Fbuilder-ainative-studio%23environment-variables&project-name=builder-ainative-studio&repository-name=builder-ainative-studio&demo-title=AINative+Component+Builder&demo-description=AI-powered+React+component+builder+using+Anthropic+Claude+Sonnet+4&skippable-integrations=1'

export const RAILWAY_DEPLOY_URL =
  'https://railway.app/template/deploy?referralCode=ainative-studio'
