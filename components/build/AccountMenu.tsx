'use client'

/**
 * AccountMenu (#56) — unified account nav dropdown for the /build shell.
 *
 * Mounts in WorkspaceShell's ActBar (top-right), replacing the bare account
 * chip with a proper popover menu. Items are auth-state-aware:
 *
 *   GUEST  → Portfolio (greyed, badge), Credits (greyed), Billing (greyed),
 *             Settings (greyed), Help & Docs, Refer & Earn (coming soon),
 *             divider, Sign up / Log in CTA.
 *
 *   AUTHED → Portfolio, Credits, Billing, Settings, Help & Docs,
 *             Refer & Earn (coming soon), divider, identity + Logout.
 *
 * Design: matches .modernist chrome — no Lucide icons, typographic glyphs
 * only, 0-radius, 2px dividers, IBM Plex Mono for metadata.
 */

import { useRef, useEffect, useCallback } from 'react'
import { signOut } from 'next-auth/react'
import { isGuestSession, getDisplayName, getDisplayEmail } from '@/lib/build/account-session'
import type { Session } from 'next-auth'

// ── Menu item descriptors ─────────────────────────────────────────────────────

export type MenuItemId =
  | 'portfolio'
  | 'credits'
  | 'billing'
  | 'settings'
  | 'help'
  | 'refer'
  | 'auth'
  | 'logout'

export interface MenuItem {
  id: MenuItemId
  label: string
  glyph: string
  /** true = interactive for this session type */
  enabled: boolean
  /** small badge text rendered right-aligned */
  badge?: string
}

/**
 * Derive the ordered list of menu items for the given auth state.
 * Pure function — straightforward to unit-test without React.
 */
export function buildMenuItems(isGuest: boolean): MenuItem[] {
  return [
    {
      id: 'portfolio',
      label: 'My Portfolio',
      glyph: '◈',
      enabled: !isGuest,
      badge: isGuest ? 'Sign in' : undefined,
    },
    {
      id: 'credits',
      label: 'Credits',
      glyph: '⬡',
      enabled: !isGuest,
      badge: isGuest ? 'Sign in' : undefined,
    },
    {
      id: 'billing',
      label: 'Billing',
      glyph: '▲',
      enabled: !isGuest,
      badge: isGuest ? 'Sign in' : undefined,
    },
    {
      id: 'settings',
      label: 'Settings',
      glyph: '◎',
      enabled: !isGuest,
      badge: isGuest ? 'Sign in' : undefined,
    },
    {
      id: 'help',
      label: 'Help & Docs',
      glyph: '?',
      enabled: true,
    },
    {
      id: 'refer',
      label: 'Refer & Earn',
      glyph: '⇢',
      // Coming soon (#59) — render but disabled for all users.
      enabled: false,
      badge: 'Soon',
    },
    // Sentinel: determines whether bottom row is Sign up/Log in or Logout.
    {
      id: isGuest ? 'auth' : 'logout',
      label: isGuest ? 'Sign up / Log in' : 'Log out',
      glyph: isGuest ? '→' : '↩',
      enabled: true,
    },
  ]
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AccountMenuProps {
  session: Session | null | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Navigate to a named screen in the build state machine */
  onScreen: (screen: string) => void
}

export function AccountMenu({ session, open, onOpenChange, onScreen }: AccountMenuProps) {
  const isGuest = isGuestSession(session)
  const displayName = getDisplayName(session)
  const displayEmail = getDisplayEmail(session)
  const initials = isGuest
    ? 'GU'
    : (displayName || displayEmail || 'GU').slice(0, 2).toUpperCase()

  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const items = buildMenuItems(isGuest)

  // Close on click-outside or Escape.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    },
    [onOpenChange],
  )

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false)
      }
    },
    [onOpenChange],
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, handleClickOutside, handleKeyDown])

  // Focus first focusable item when the menu opens.
  useEffect(() => {
    if (open && menuRef.current) {
      const first = menuRef.current.querySelector<HTMLElement>(
        'button:not([disabled]), a:not([disabled])',
      )
      first?.focus()
    }
  }, [open])

  const handleItem = (item: MenuItem) => {
    if (!item.enabled) return
    onOpenChange(false)
    switch (item.id) {
      case 'portfolio':
        onScreen('companies')
        break
      case 'credits':
        // Account screen contains the credits / usage meters section.
        onScreen('account')
        break
      case 'billing':
        onScreen('pricing')
        break
      case 'settings':
        // #57 ships editable profile/settings inside the Account screen.
        onScreen('account')
        break
      case 'help':
        // #60 ships /help; also link docs.ainative.studio via the page itself.
        window.open('/help', '_blank', 'noopener,noreferrer')
        break
      case 'refer':
        // #59 not yet built — disabled, badge="Soon", no-op.
        break
      case 'auth':
        onScreen('signup')
        break
      case 'logout':
        signOut()
        break
    }
  }

  // Split so we can render the divider before the auth/logout item.
  const mainItems = items.slice(0, -1)
  const bottomItem = items[items.length - 1]

  return (
    <div className="m-acct-menu-wrap" data-testid="account-menu-wrap">
      {/* Trigger chip */}
      <button
        ref={triggerRef}
        className={`m-account-chip m-mono${open ? ' is-open' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Account menu"
        data-testid="account-menu-trigger"
        onClick={() => onOpenChange(!open)}
      >
        <span className="m-account-initials" aria-hidden="true">
          {initials}
        </span>
        <span className="m-token-meter" aria-hidden="true">
          <span style={{ width: '38%' }} />
        </span>
        <span className="m-acct-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={menuRef}
          className="m-acct-dropdown"
          role="menu"
          aria-label="Account navigation"
          data-testid="account-menu-dropdown"
        >
          {/* Identity header */}
          <div className="m-acct-identity" data-testid="account-menu-identity">
            <span className="m-acct-avatar m-mono" aria-hidden="true">
              {initials}
            </span>
            <div className="m-acct-id-text">
              <div className="m-acct-id-name" data-testid="account-menu-name">
                {isGuest ? 'Guest Session' : displayName}
              </div>
              {!isGuest && displayEmail && (
                <div
                  className="m-acct-id-email m-mono"
                  data-testid="account-menu-email"
                >
                  {displayEmail}
                </div>
              )}
              {isGuest && (
                <div
                  className="m-acct-id-email m-mono"
                  data-testid="account-menu-guest-label"
                >
                  Temporary — not saved
                </div>
              )}
            </div>
          </div>

          <div className="m-acct-divider" role="separator" />

          {/* Main nav items */}
          {mainItems.map((item) => (
            <button
              key={item.id}
              className={`m-acct-item m-mono${!item.enabled ? ' is-disabled' : ''}`}
              role="menuitem"
              aria-disabled={!item.enabled}
              data-testid={`account-menu-item-${item.id}`}
              onClick={() => handleItem(item)}
              tabIndex={item.enabled ? 0 : -1}
            >
              <span className="m-acct-item-glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span className="m-acct-item-label">{item.label}</span>
              {item.badge && (
                <span
                  className="m-acct-badge m-mono"
                  data-testid={`account-menu-badge-${item.id}`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          ))}

          <div className="m-acct-divider" role="separator" />

          {/* Auth row: Sign up/Log in (guest) OR Log out (authed) */}
          <button
            className={`m-acct-item m-acct-item--auth m-mono${
              bottomItem.id === 'logout' ? ' is-logout' : ' is-login'
            }`}
            role="menuitem"
            data-testid={`account-menu-item-${bottomItem.id}`}
            onClick={() => handleItem(bottomItem)}
          >
            <span className="m-acct-item-glyph" aria-hidden="true">
              {bottomItem.glyph}
            </span>
            <span className="m-acct-item-label">{bottomItem.label}</span>
          </button>
        </div>
      )}
    </div>
  )
}
