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
    icon: '/icon.svg',
    apple: '/apple-icon.png',
  },
  keywords: [
    'AI app builder', 'AI UI generator', 'React component generator', 'text to UI',
    'prompt to website', 'AI frontend builder', 'AI code generator', 'Next.js generator',
    'v0 alternative', 'lovable alternative', 'bolt alternative', 'base44 alternative',
    'AI web app builder', 'agent-optimized', 'AX optimization', 'shadcn AI',
    'build app with AI', 'no code AI builder', 'Claude Sonnet 4',
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
        highPrice: '99',
        priceCurrency: 'USD',
        offerCount: 3,
        offers: [
          { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD', description: '10K tokens/month, open-source models' },
          { '@type': 'Offer', name: 'Pro', price: '29', priceCurrency: 'USD', description: '500K tokens/month, Claude Sonnet 4' },
          { '@type': 'Offer', name: 'Team', price: '99', priceCurrency: 'USD', description: '2M tokens/month, all models' },
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
      '@type': 'Organization',
      name: 'AINative Studio',
      url: 'https://ainative.studio',
      logo: 'https://builder.ainative.studio/ainative-logo-v2.png',
      sameAs: [
        'https://github.com/AINative-Studio',
      ],
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
        <SessionProvider>
          <SWRProvider>
            <StreamingProvider>
              {children}
              <Toaster />
            </StreamingProvider>
          </SWRProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
