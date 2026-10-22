import * as React from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

export interface DegradedStateBannerProps {
  /** Human-readable explanation of what's degraded and why (#1191). */
  message: string
  /** Optional short label; defaults to a generic degraded-service title. */
  title?: string
  className?: string
}

/**
 * Visible degraded-state notice for an external dependency outage (#1191).
 *
 * Several external dependencies (design tokens MCP, template-matching
 * embeddings, ZeroDB, model APIs) previously failed by either hanging or
 * silently rendering a fallback with zero indication anything was wrong.
 * This renders the same real `Alert` primitive used elsewhere in the app
 * so a degraded dependency is always visibly communicated to the user
 * instead of silently substituted.
 */
export function DegradedStateBanner({
  message,
  title = 'Reduced functionality',
  className,
}: DegradedStateBannerProps) {
  return (
    <Alert
      data-testid="degraded-state-banner"
      className={cn('border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200', className)}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
