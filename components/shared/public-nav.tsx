'use client'

/**
 * PublicNav — Modernist nav for the public marketing pages (about, pricing,
 * compare, guides, help, capabilities, showcase, templates, etc.), matching
 * components/build/screens/Landing.tsx's `.m-land-nav` exactly. These pages
 * previously used the shared `AppHeader` (a blue, rounded, shadcn-styled nav
 * meant for the authenticated app shell) — that component is NOT touched
 * here since it's also used by /deployments, /settings, /admin, which are
 * out of scope. This is a separate, purpose-built nav for the cold, public,
 * pre-login pages only.
 *
 * Every page using this MUST wrap its content in a `.modernist` root div
 * (see Landing.tsx) so the design tokens and the global border-radius reset
 * apply.
 */

import Link from 'next/link'
import { useSession } from 'next-auth/react'

export interface PublicNavLink {
  href: string
  label: string
}

const DEFAULT_LINKS: PublicNavLink[] = [
  { href: '/guides', label: 'Guides' },
  { href: '/about', label: 'About' },
  { href: '/help', label: 'Help' },
  { href: '/pricing', label: 'Pricing' },
]

export function PublicNav({ links = DEFAULT_LINKS }: { links?: PublicNavLink[] }) {
  const { status } = useSession()

  return (
    <div className="m-land-nav">
      <Link href="/" className="m-land-brand" style={{ textDecoration: 'none', color: 'inherit' }}>
        <img className="m-land-brand-icon" alt="" aria-hidden="true"
          src="https://ainative.studio/mediakit/logos/ainative-studio-logo-mark-primary.svg" />
        <div className="m-land-title" style={{ fontSize: 22 }}>BUILDER</div>
        <span className="m-land-brand-by m-mono">by AINative</span>
      </Link>
      <div className="m-land-nav-actions">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="m-land-signin" style={{ textDecoration: 'none' }}>
            {l.label}
          </Link>
        ))}
        {status === 'authenticated' ? (
          <Link href="/build?screen=companies" className="m-land-signin" data-testid="public-nav-open-builder">
            Open Builder →
          </Link>
        ) : (
          <Link href="/build?screen=login" className="m-land-signin" data-testid="public-nav-signin">
            Sign in
          </Link>
        )}
      </div>
    </div>
  )
}
