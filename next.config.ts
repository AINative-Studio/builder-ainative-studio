import type { NextConfig } from 'next'
import path from 'path'
import { withSentryConfig } from '@sentry/nextjs'

// `@ainative/ai-kit@0.2.0` statically imports `AIStream` from the Node-only
// `@ainative/ai-kit-core` package. The builder only uses ai-kit's presentational
// components (never `useAIStream`), so we alias the core package to a
// browser-safe stub to keep it out of client bundles (issue #6).
//
// Turbopack resolves string alias values relative to the project root when they
// begin with `./`, while webpack requires an absolute path.
const aiKitCoreStubAbs = path.resolve(
  __dirname,
  'lib/aikit/ai-kit-core-browser-stub.ts',
)
const aiKitCoreStubRel = './lib/aikit/ai-kit-core-browser-stub.ts'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      '@ainative/ai-kit-core': aiKitCoreStubRel,
    },
  },
  webpack: (config) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@ainative/ai-kit-core': aiKitCoreStubAbs,
    }
    return config
  },
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async headers() {
    return [
      {
        // Allow preview and API preview routes to be iframed (same-origin)
        source: '/preview/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/api/preview/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        // All other routes — SAMEORIGIN allows iframes from same domain
        // (needed for preview iframes in builder and showcase)
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      silent: true,
      widenClientFileUpload: true,
    })
  : nextConfig
