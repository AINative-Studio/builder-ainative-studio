'use client'

/**
 * MenuChip — the Polsia-parity account MENU, mountable on ANY builder screen
 * (Fork, My Builds, Live, Landing), not just the workspace act-bar. Wraps the
 * existing AccountMenu (#56: portfolio / credits / billing / settings / help /
 * refer / auth) with its own session + open state + navigation, so screens
 * outside WorkspaceShell get the same upper-right menu the founder expects
 * everywhere once signed in.
 */

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useBuild } from '@/contexts/build-context'
import { AccountMenu } from '@/components/build/AccountMenu'
import type { Screen } from '@/lib/build/state'

export function MenuChip() {
  const { data: session } = useSession()
  const { dispatch } = useBuild()
  const [open, setOpen] = useState(false)

  return (
    <AccountMenu
      session={session}
      open={open}
      onOpenChange={setOpen}
      onScreen={(screen) => dispatch({ type: 'GOTO_SCREEN', screen: screen as Screen })}
    />
  )
}
