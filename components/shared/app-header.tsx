'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChatSelector } from './chat-selector'
import { MobileMenu } from './mobile-menu'
import { useSession } from 'next-auth/react'
import { UserNavClient } from '@/components/user-nav-client'
import { Button } from '@/components/ui/button'
import { DEPLOY_URL } from '@/lib/constants'
import { LayoutTemplate } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface AppHeaderProps {
  className?: string
}

// Component that uses useSearchParams - needs to be wrapped in Suspense
function SearchParamsHandler() {
  const searchParams = useSearchParams()
  const { update } = useSession()

  // Force session refresh when redirected after auth
  useEffect(() => {
    const shouldRefresh = searchParams.get('refresh') === 'session'

    if (shouldRefresh) {
      // Force session update
      update()

      // Clean up URL without causing navigation
      const url = new URL(window.location.href)
      url.searchParams.delete('refresh')
      window.history.replaceState({}, '', url.pathname)
    }
  }, [searchParams, update])

  return null
}

export function AppHeader({ className = '' }: AppHeaderProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const isHomepage = pathname === '/'
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false)

  // Handle logo click - reset UI if on homepage, otherwise navigate to homepage
  const handleLogoClick = (e: React.MouseEvent) => {
    if (isHomepage) {
      e.preventDefault()
      // Add reset parameter to trigger UI reset
      window.location.href = '/?reset=true'
    }
    // If not on homepage, let the Link component handle navigation normally
  }

  return (
    <div
      className={`${!isHomepage ? 'border-b border-border dark:border-input' : ''} ${className}`}
    >
      {/* Handle search params with Suspense boundary */}
      <Suspense fallback={null}>
        <SearchParamsHandler />
      </Suspense>

      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left side - Logo and Selector */}
          <div className="flex items-center gap-4">
            <Link
              href="/"
              onClick={handleLogoClick}
              className="flex items-center gap-3 text-lg font-semibold hover:opacity-80 transition-opacity"
            >
              <svg width="32" height="32" viewBox="0 0 100 85" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
                <path d="M19.8676 68.0037L32.1669 83.17C32.3171 83.3551 32.4375 83.5627 32.5512 83.7722C33.4124 85.3588 34.8373 85.4186 35.6263 83.8883C35.7713 83.607 35.8184 83.2872 35.8184 82.9708L35.8183 68.0037L19.8676 68.0037Z" fill="white"/>
                <path d="M73.6886 3.57796H82.2931C85.8061 3.57796 88.6539 6.42579 88.6539 9.93878V25.3821C88.6539 27.1918 89.4248 28.9158 90.7734 30.1225L96.2074 34.9845L90.7734 39.8465C89.4248 41.0532 88.6539 42.7772 88.6539 44.5869V59.2351C88.6539 62.7481 85.8061 65.596 82.2931 65.596H73.6886" stroke="#5867EF" strokeWidth="7.1413" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M59.7906 65.596L17.4922 65.596C13.9793 65.596 11.1314 62.7481 11.1314 59.2351L11.1314 43.7918C11.1314 41.9821 10.3606 40.2581 9.01197 39.0514L3.57796 34.1894L9.01197 29.3274C10.3606 28.1207 11.1314 26.3967 11.1314 24.587L11.1314 9.93879C11.1314 6.4258 13.9793 3.57796 17.4923 3.57796L59.7906 3.57797" stroke="white" strokeWidth="7.1413" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="font-bold text-gray-900 dark:text-white">
                AINative
              </span>
            </Link>
            {/* Hide ChatSelector on mobile */}
            <div className="hidden lg:block">
              <ChatSelector />
            </div>
          </div>

          {/* Desktop right side - Navigation + User */}
          <div className="hidden lg:flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/templates">
                <LayoutTemplate className="w-4 h-4 mr-1" />
                Templates
              </Link>
            </Button>
            <UserNavClient session={session} />
          </div>

          {/* Mobile right side - Only menu button and user avatar */}
          <div className="flex lg:hidden items-center gap-2">
            <UserNavClient session={session} />
            <MobileMenu onInfoDialogOpen={() => setIsInfoDialogOpen(true)} />
          </div>
        </div>
      </div>

      {/* Info Dialog */}
      <Dialog open={isInfoDialogOpen} onOpenChange={setIsInfoDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold mb-4 flex items-center gap-3">
              <svg width="32" height="32" viewBox="0 0 100 85" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
                <path d="M19.8676 68.0037L32.1669 83.17C32.3171 83.3551 32.4375 83.5627 32.5512 83.7722C33.4124 85.3588 34.8373 85.4186 35.6263 83.8883C35.7713 83.607 35.8184 83.2872 35.8184 82.9708L35.8183 68.0037L19.8676 68.0037Z" fill="currentColor"/>
                <path d="M73.6886 3.57796H82.2931C85.8061 3.57796 88.6539 6.42579 88.6539 9.93878V25.3821C88.6539 27.1918 89.4248 28.9158 90.7734 30.1225L96.2074 34.9845L90.7734 39.8465C89.4248 41.0532 88.6539 42.7772 88.6539 44.5869V59.2351C88.6539 62.7481 85.8061 65.596 82.2931 65.596H73.6886" stroke="#5867EF" strokeWidth="7.1413" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M59.7906 65.596L17.4922 65.596C13.9793 65.596 11.1314 62.7481 11.1314 59.2351L11.1314 43.7918C11.1314 41.9821 10.3606 40.2581 9.01197 39.0514L3.57796 34.1894L9.01197 29.3274C10.3606 28.1207 11.1314 26.3967 11.1314 24.587L11.1314 9.93879C11.1314 6.4258 13.9793 3.57796 17.4923 3.57796L59.7906 3.57797" stroke="currentColor" strokeWidth="7.1413" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              AINative Platform
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
            <p>
              <strong>AINative</strong> is an AI-powered UI generation platform where users can enter text prompts
              and generate beautiful, production-ready React components and applications using advanced AI models.
            </p>
            <p>
              It's built with{' '}
              <a
                href="https://nextjs.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                Next.js
              </a>{' '}
              and the{' '}
              <a
                href="https://v0-sdk.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                v0 SDK
              </a>{' '}
              to provide a full-featured interface with authentication, database
              integration, and real-time streaming responses.
            </p>
            <p>
              Try the demo or{' '}
              <a
                href={DEPLOY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                deploy your own
              </a>
              .
            </p>
          </div>
          <div className="flex justify-end mt-6">
            <Button
              onClick={() => setIsInfoDialogOpen(false)}
              className="bg-gray-900 dark:bg-gray-100 hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-gray-900"
            >
              Try now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
