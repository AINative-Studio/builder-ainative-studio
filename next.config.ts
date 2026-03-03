import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true, // Enable strict mode for better development experience
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
}

export default nextConfig
