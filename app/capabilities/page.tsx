import type { Metadata } from 'next'
import Link from 'next/link'
import { AppHeader } from '@/components/shared/app-header'
import { CAPABILITIES } from '@/lib/build/capabilities'

export const metadata: Metadata = {
  title: 'What can I build? — AINative Builder capabilities',
  description:
    'Plain-English overview of what you can build with AINative: a CRM, an online store, invoicing, a helpdesk, phone/SMS, a nonprofit backend, and more — each included, no extra keys or subscriptions.',
}

/**
 * /capabilities (#313 GR-04 / #316 GR-07) — the plain-English "what can I build"
 * surface. Cody's discovery routing points here for capability-discovery intents
 * (NOT the raw API reference). Sourced from lib/build/capabilities.ts.
 */
export default function CapabilitiesPage() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-10">
          <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">AINative Builder</p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">What can I build?</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Describe an idea and Cody builds it on real AINative products — each one included,
            with no extra signup, key, or subscription. Here’s what’s available, in plain English.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div key={c.product} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground">{c.product}</h2>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  included
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground/90">{c.build}</p>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {c.examples.map((ex) => (
                  <li key={ex} className="flex gap-2">
                    <span aria-hidden>→</span>
                    <span>{ex}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/70">Replaces:</span> {c.replaces}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-border bg-muted/40 p-6 text-center">
          <p className="text-foreground">Got an idea? You don’t need to pick a product — just describe what you want.</p>
          <Link
            href="/build"
            className="mt-4 inline-block rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Start building →
          </Link>
        </div>
      </main>
    </div>
  )
}
