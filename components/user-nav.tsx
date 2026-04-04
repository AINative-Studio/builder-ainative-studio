'use client'

import { useState, useEffect } from 'react'
import { signOut } from 'next-auth/react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, User, BarChart3, AlertCircle, Palette, Coins, KeyRound } from 'lucide-react'
import { Session } from 'next-auth'
import Link from 'next/link'

interface UserNavProps {
  session: Session | null
}

export function UserNav({ session }: UserNavProps) {
  const [credits, setCredits] = useState<{ balance: any; usage: any } | null>(null)

  const initials =
    session?.user?.email?.split('@')[0]?.slice(0, 2)?.toUpperCase() || 'U'

  const isGuest = session?.user?.type === 'guest'
  const isAINative = session?.user?.type === 'ainative'
  const isSignedOut = !session
  // @ts-ignore - TODO: Add proper type for user role
  const isAdmin = session?.user?.role === 'admin'

  // Fetch credits for AINative users
  useEffect(() => {
    if (isAINative) {
      fetch('/api/credits')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) setCredits(data)
        })
        .catch(() => {})
    }
  }, [isAINative])

  const displayName = isSignedOut
    ? 'Not signed in'
    : isGuest
      ? 'Guest User'
      : session?.user?.name || session?.user?.email?.split('@')[0] || 'User'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {isSignedOut ? <User className="h-4 w-4" /> : initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {displayName}
            </p>
            {session?.user?.email && (
              <p className="text-xs leading-none text-muted-foreground">
                {session.user.email}
              </p>
            )}
            {isAINative && credits?.balance && (
              <p className="text-xs leading-none text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                <Coins className="h-3 w-3" />
                ${typeof credits.balance.balance === 'number'
                  ? credits.balance.balance.toFixed(2)
                  : credits.balance.balance ?? '0.00'}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Navigation Links */}
        {!isSignedOut && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/design-tokens" className="cursor-pointer">
                <Palette className="mr-2 h-4 w-4" />
                <span>Design Tokens</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem asChild>
              <Link href="/insights" className="cursor-pointer">
                <BarChart3 className="mr-2 h-4 w-4" />
                <span>Quality Insights</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem asChild>
              <Link href="/settings/credentials" className="cursor-pointer">
                <KeyRound className="mr-2 h-4 w-4" />
                <span>API Credentials</span>
              </Link>
            </DropdownMenuItem>

            {isAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/admin/errors" className="cursor-pointer">
                  <AlertCircle className="mr-2 h-4 w-4" />
                  <span>Error Monitoring</span>
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}

        {(isGuest || isSignedOut) && (
          <>
            <DropdownMenuItem asChild>
              <a href="/register" className="cursor-pointer">
                <span>Create Account</span>
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="/login" className="cursor-pointer">
                <span>Sign In</span>
              </a>
            </DropdownMenuItem>
            {!isSignedOut && <DropdownMenuSeparator />}
          </>
        )}
        {!isSignedOut && (
          <DropdownMenuItem
            onClick={async () => {
              await signOut({ callbackUrl: '/', redirect: true })
            }}
            className="cursor-pointer"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sign out</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
