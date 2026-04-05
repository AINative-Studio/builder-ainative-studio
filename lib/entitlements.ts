import type { UserType } from '@/app/(auth)/auth'

interface Entitlements {
  maxMessagesPerDay: number
  maxTokensPerRequest: number
  canUseExtendedThinking: boolean
  canSelectModel: boolean
}

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For users without an account (anonymous)
   */
  guest: {
    maxMessagesPerDay: 20,
    maxTokensPerRequest: 8000,
    canUseExtendedThinking: false,
    canSelectModel: true,
  },

  /*
   * For users with a local account
   */
  regular: {
    maxMessagesPerDay: 50,
    maxTokensPerRequest: 16000,
    canUseExtendedThinking: true,
    canSelectModel: true,
  },

  /*
   * For users authenticated via AINative platform (credit-based)
   */
  ainative: {
    maxMessagesPerDay: 200,
    maxTokensPerRequest: 32000,
    canUseExtendedThinking: true,
    canSelectModel: true,
  },
}

// For anonymous users (no session)
export const anonymousEntitlements: Entitlements = {
  maxMessagesPerDay: 10,
  maxTokensPerRequest: 4000,
  canUseExtendedThinking: false,
  canSelectModel: false,
}
