import type { Metadata } from 'next'
import { Geist, Geist_Mono, Poppins } from 'next/font/google'
import './globals.css'
import { StreamingProvider } from '@/contexts/streaming-context'
import { SWRProvider } from '@/components/providers/swr-provider'
import { SessionProvider } from '@/components/providers/session-provider'
import { Toaster } from '@/components/ui/toaster'

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

export const metadata: Metadata = {
  title: {
    default: 'AINative Builder - AI App Builder | Generate React Apps with AI',
    template: '%s | AINative Builder',
  },
  description:
    'Build production-ready React apps and components with AI. The best alternative to v0, Lovable, and Bolt. Agent-optimized with AX scoring, SEO, structured data, and multi-model support including Claude Sonnet 4.',
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
    // Primary - exact match targets
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
    title: 'AINative Builder - Build React Apps with AI',
    description: 'AI-powered React component builder. Generate production-ready apps from prompts with AX optimization, SEO, and structured data. Best v0 & Lovable alternative.',
    siteName: 'AINative Builder',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AINative Builder - Build React Apps with AI',
    description: 'AI-powered React component builder. Generate production-ready apps from prompts with AX optimization and SEO built in.',
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

// Dual JSON-LD: WebApplication + Organization (like Bolt, but richer)
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'AINative Builder',
      url: 'https://builder.ainative.studio',
      description: 'AI-powered React component builder that generates production-ready web applications from natural language prompts with AX optimization, SEO, and structured data.',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '0',
        highPrice: '699',
        priceCurrency: 'USD',
        offerCount: 4,
        offers: [
          { '@type': 'Offer', name: 'Starter', price: '0', priceCurrency: 'USD', description: '10K LLM tokens/month, 1K API credits, open-source models' },
          { '@type': 'Offer', name: 'Pro', price: '49', priceCurrency: 'USD', description: '1M LLM tokens/month, 50K API credits, Claude Sonnet 4, 10GB storage' },
          { '@type': 'Offer', name: 'Business', price: '149', priceCurrency: 'USD', description: '5M LLM tokens/month, 150K API credits, all models, Cody AI agent, 50GB storage' },
          { '@type': 'Offer', name: 'Enterprise', price: '699', priceCurrency: 'USD', description: '10M LLM tokens/month, 200K API credits, Agent Swarm, 100GB storage, SSO' },
        ],
      },
      featureList: [
        'AI React component generation',
        'Multi-model support (Claude, Qwen, Gemma, DeepSeek)',
        'Agent Experience (AX) optimization',
        'Automatic SEO and structured data',
        'Real-time streaming preview',
        'Template gallery',
        'One-click deployment',
        'Design token system',
      ],
      screenshot: 'https://builder.ainative.studio/opengraph-image',
      softwareVersion: '1.0.0',
    },
    {
      '@type': 'WebSite',
      name: 'AINative Builder',
      url: 'https://builder.ainative.studio',
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://builder.ainative.studio/templates?search={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'Organization',
      name: 'AINative Studio',
      url: 'https://ainative.studio',
      logo: 'https://builder.ainative.studio/ainative-logo-v2.png',
      description: 'Open-source AI-native IDE with agent memory, vector search, and multi-model support.',
      sameAs: [
        'https://github.com/AINative-Studio',
        'https://twitter.com/AINativeStudio',
      ],
      parentOrganization: {
        '@type': 'Organization',
        name: 'AINative Studio',
        url: 'https://ainative.studio',
      },
    },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
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
        className={`${poppins.variable} ${geistSans.variable} ${geistMono.variable} antialiased`}
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
            </StreamingProvider>
          </SWRProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
