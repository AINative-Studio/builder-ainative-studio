'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Zap, X, ArrowRight, Sparkles } from 'lucide-react'

interface UpgradeBannerProps {
  type: 'limit-reached' | 'approaching-limit' | 'inline'
  tokensUsed?: number
  tokenLimit?: number
  onDismiss?: () => void
}

export function UpgradeBanner({ type, tokensUsed, tokenLimit, onDismiss }: UpgradeBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const usagePercent = tokensUsed && tokenLimit ? Math.round((tokensUsed / tokenLimit) * 100) : 0

  if (type === 'limit-reached') {
    return (
      <div className="mx-auto max-w-2xl mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <div className="flex justify-center mb-3">
          <div className="rounded-full bg-amber-500/10 p-3">
            <Zap className="h-6 w-6 text-amber-500" />
          </div>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Free Plan Limit Reached
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          You've used all your free tokens this month. Upgrade to Pro for 1M tokens/month
          and access to Claude Sonnet 4 — the most capable AI model for code generation.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button
            asChild
            className="bg-[#5867EF] hover:bg-[#4756DE] text-white"
          >
            <a href="https://ainative.studio/#pricing" target="_blank" rel="noopener noreferrer">
              <Sparkles className="w-4 h-4 mr-2" />
              Upgrade to Pro — $49/mo
              <ArrowRight className="w-4 h-4 ml-2" />
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setDismissed(true); onDismiss?.() }}>
            Maybe later
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Pro includes Claude Sonnet 4, 1M tokens, 50K API credits, and 10GB storage
        </p>
      </div>
    )
  }

  if (type === 'approaching-limit') {
    return (
      <div className="mx-auto max-w-2xl mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-medium">{usagePercent}% of free tokens used</span>
              {' '}({tokensUsed?.toLocaleString()}/{tokenLimit?.toLocaleString()})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="https://ainative.studio/#pricing" target="_blank" rel="noopener noreferrer">
              Upgrade
            </a>
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setDismissed(true); onDismiss?.() }}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    )
  }

  // Inline upgrade CTA (for error messages)
  return (
    <div className="mt-3 text-center">
      <Button variant="outline" size="sm" asChild>
        <a href="https://ainative.studio/#pricing" target="_blank" rel="noopener noreferrer">
          <Sparkles className="w-3 h-3 mr-1" />
          Upgrade for more generations
        </a>
      </Button>
    </div>
  )
}
