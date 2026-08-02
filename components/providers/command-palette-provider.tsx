'use client'

/**
 * Command Palette Provider
 *
 * Globally mounts the Cmd+K command palette (Issue #17) and wires it to the
 * authenticated session. Renders nothing for signed-out visitors so public
 * marketing pages are unaffected.
 *
 * The palette itself owns the Cmd+K / Ctrl+K key handler; this provider just
 * supplies open state and the current user id.
 */

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { CommandPalette } from '@/components/command-palette'

export function CommandPaletteProvider() {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)

  // Only mount for authenticated users. Command execution requires a user id
  // and hits authenticated API routes, so there is nothing to show otherwise.
  const userId = session?.user?.id
  if (status !== 'authenticated' || !userId) {
    return null
  }

  return (
    <CommandPalette open={open} onOpenChange={setOpen} userId={userId} />
  )
}
