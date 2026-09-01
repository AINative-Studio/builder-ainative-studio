import { hostedMcpNotImplemented } from '@/lib/build/hosted-mcp-not-implemented'

// /build/strapi/{path} — Refs core#6667. See hostedMcpNotImplemented for context.
export const GET = hostedMcpNotImplemented('strapi')
export const POST = hostedMcpNotImplemented('strapi')
