import type { Metadata } from 'next'
import { Geist, Geist_Mono, Poppins, Archivo, Newsreader, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import './modernist.css'
import { StreamingProvider } from '@/contexts/streaming-context'
import { SWRProvider } from '@/components/providers/swr-provider'
import { SessionProvider } from '@/components/providers/session-provider'
import { Toaster } from '@/components/ui/toaster'
import { CommandPaletteProvider } from '@/components/providers/command-palette-provider'
import GoogleAnalytics from '@/components/analytics/google-analytics'
import MetaPixel from '@/components/analytics/meta-pixel'

const poppins = Poppins({
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-poppins',
  subsets: ['latin'],
})

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// Modernist design-system fonts (builder chrome only — see docs/AINATIVE_PRIMITIVES.md pivot).
// Archivo = UI chrome, Newsreader = Cody's generated "artifact" prose, IBM Plex Mono = machine text.
const archivo = Archivo({
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-archivo',
  subsets: ['latin'],
})

const newsreader = Newsreader({
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
  subsets: ['latin'],
})

const plexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'AINative Builder - AI That Builds AND Runs Your Company',
    template: '%s | AINative Builder',
  },
  description:
    'Describe your company or your app. Cody, your AI co-founder, builds it, launches it, and runs it 24/7 on real AINative primitives you own — the AI that builds AND runs your company.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'),
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/ainative-logo-v2.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
  manifest: '/manifest.json',
  keywords: [
    // Primary - company-outcome positioning (#207/#208)
    'AI that runs your company', 'AI that builds your company', 'AI co-founder',
    'autonomous AI company', 'AI business builder', 'build a company with AI',
    'agent-run company', 'AI startup generator', 'AI-native company', 'Polsia alternative',
    // Secondary - app-builder intent (demoted, kept for existing ranked keywords)
    'AI app builder', 'AI UI generator', 'AI web app builder', 'AI frontend builder',
    'React component generator', 'Next.js generator', 'AI code generator',
    'text to UI', 'prompt to website', 'build app with AI',
    // Competitor alternatives
    'v0 alternative', 'lovable alternative', 'bolt alternative', 'bolt.new alternative',
    'base44 alternative', 'replit alternative', 'cursor alternative', 'create.xyz alternative',
    // AINative differentiators
    'agent-optimized', 'AX optimization', 'agent experience', 'agent-first architecture',
    'AI agent builder', 'agent accessible', 'structured data generator',
    // Technology
    'shadcn AI', 'Claude Sonnet 4', 'multi-model AI', 'Qwen Coder',
    'no code AI builder', 'AI prototype builder', 'AI SaaS builder',
    // Use cases
    'AI dashboard generator', 'AI landing page builder', 'AI e-commerce builder',
    'AI admin panel generator', 'generate React app', 'AI component library',
    // Long-tail
    'best AI app builder 2026', 'free AI website builder', 'AI builder with SEO',
    'open source AI builder', 'AINative Studio builder', 'ZeroDB AI builder',
  ],
  openGraph: {
    title: 'AINative Builder - AI That Builds AND Runs Your Company',
    description: 'Describe your company or app. Cody, your AI co-founder, builds it, launches it, and runs it 24/7 on real AINative primitives you own.',
    siteName: 'AINative Builder',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AINative Builder - AI That Builds AND Runs Your Company',
    description: 'Your first employee. Ships product, runs growth, never sleeps. Cody builds your company, launches it, and runs it 24/7 on real primitives you own.',
    creator: '@AINativeStudio',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-video-preview': -1, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  alternates: {
    canonical: 'https://builder.ainative.studio',
  },
  verification: {},
}

// Site-wide JSON-LD lives on individual pages (app/page.tsx, app/pricing/page.tsx,
// app/best/[category]/page.tsx, app/compare/[competitor]/page.tsx, app/about/page.tsx,
// etc.), each with data matching its own real content. A global block used to live
// here and was injected on every route, including auth-shell pages that have no
// business advertising Offers — it duplicated and conflicted with page-level schema
// (two different Product/Offer blocks with two different prices on the same page)
// and had gone stale (Business tier priced at $149, when lib/build/pricing-tiers.ts
// has been $199 since #76). This was very likely the root cause of the "444 invalid
// structured data items" finding in docs/growth/TECHNICAL_SEO_AUDIT_2026-09-06.md —
// removed rather than fixed in place, since every route that needs structured data
// already defines its own, correct copy.

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
                
                // Listen for changes in system preference
                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
                  if (e.matches) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                });
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${poppins.variable} ${geistSans.variable} ${geistMono.variable} ${archivo.variable} ${newsreader.variable} ${plexMono.variable} antialiased`}
      >
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:text-black">
          Skip to main content
        </a>
        <SessionProvider>
          <SWRProvider>
            <StreamingProvider>
              <div id="main-content">
                {children}
              </div>
              <Toaster />
              <CommandPaletteProvider />
            </StreamingProvider>
          </SWRProvider>
        </SessionProvider>
        <GoogleAnalytics />
        <MetaPixel />
      </body>
    </html>
  )
}
