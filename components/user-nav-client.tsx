'use client'

import dynamic from 'next/dynamic'
import { Session } from 'next-auth'

// Dynamically import UserNav with client-side only rendering
// This prevents hydration mismatches from Radix UI's random ID generation
const UserNavComponent = dynamic(
  () => import('./user-nav').then(mod => ({ default: mod.UserNav })),
  { ssr: false }
)

interface UserNavClientProps {
  session: Session | null
}

export function UserNavClient({ session }: UserNavClientProps) {
  return <UserNavComponent session={session} />
}
