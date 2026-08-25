// Pricing tiers — single source of truth for the /pricing page (#76) + tests.
// Lives in lib (not the page) because Next.js page files may only export page-specific symbols.
export const PRICING_TIERS = [
  {
    id: 'free',
    name: 'Free',
    monthly: 0,
    tagline: 'Try Cody. Build your first app.',
    featured: false,
    features: [
      'Cody builds a preview app from your idea',
      'Shareable live URL',
      'No credit card required',
      'AINative open primitives (read)',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 49,
    tagline: 'Build it for real.',
    featured: true,
    features: [
      'Cody builds your app + company',
      '1M tokens · 50K API calls · 10 GB storage',
      'Real generation (Claude Sonnet 4.5)',
      'Custom domain available',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    monthly: 199,
    tagline: 'Cody runs it 24/7.',
    featured: false,
    features: [
      'Everything in Pro',
      'The nightly autonomous loop',
      'Sales pipeline · invoicing · helpdesk · voice',
      '5M tokens · 150K API calls · 50 GB storage',
    ],
  },
] as const
