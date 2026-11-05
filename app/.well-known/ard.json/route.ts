/**
 * GET /.well-known/ard.json — Agent Resource Discovery manifest (#1839).
 *
 * ARD is a real external standard (agenticresourcediscovery.org, authored
 * by Google/Hugging Face/Amazon/Microsoft/Cisco/Databricks/GitHub — not
 * AINative-invented). Earlier research into this gap wrongly concluded no
 * spec existed anywhere "discoverable" because it only checked
 * ainative.ax's own methodology page. It missed that ainative.studio's own
 * marketing frontend (a separate repo, AINative-website-nextjs) already
 * ships a real ard.json at public/.well-known/ard.json — that's the
 * reference this mirrors, adapted to Builder's own real, live resources
 * rather than copied verbatim (ainative.studio's entries describe core's
 * docs/SDKs, which aren't Builder's).
 *
 * Every `url` below is a real, live, already-shipping Builder endpoint —
 * no placeholder/aspirational entries.
 */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://builder.ainative.studio'

export async function GET() {
  return Response.json(
    {
      entries: [
        {
          identifier: 'urn:air:builder.ainative.studio:openapi',
          displayName: 'AINative Builder API',
          type: 'application/vnd.oai.openapi+json;version=3.0',
          url: `${BASE_URL}/openapi.json`,
          description:
            'Agent-facing REST surface for AINative Builder: generate a working web app or company from a natural-language idea, composing real AINative primitives (ZeroCommerce, ZeroPipeline, ZeroInvoice, ZeroVoice, ServiceOS, ZeroMemory, OpenCapStack) instead of hand-rolled business logic.',
          capabilities: ['AppGeneration', 'CompanyGeneration', 'PrimitiveComposition'],
          representativeQueries: [
            'how do I generate a working app from an idea with AINative Builder',
            'what primitives can AINative Builder compose into a generated company',
          ],
          trustManifest: { identity: { issuer: 'builder.ainative.studio' } },
        },
        {
          identifier: 'urn:air:builder.ainative.studio:llms-index',
          displayName: 'AINative Builder llms.txt index',
          type: 'text/markdown',
          url: `${BASE_URL}/llms.txt`,
          description: 'Markdown index of AINative Builder, written for LLM consumption per the llms.txt convention.',
          representativeQueries: ['give me an overview of AINative Builder in markdown'],
          trustManifest: { identity: { issuer: 'builder.ainative.studio' } },
        },
        {
          identifier: 'urn:air:builder.ainative.studio:agents-txt',
          displayName: 'AINative Builder agent routing manifest',
          type: 'text/plain',
          url: `${BASE_URL}/agents.txt`,
          description: 'Agent routing manifest for AINative Builder.',
          representativeQueries: ['how should an agent route requests to AINative Builder'],
          trustManifest: { identity: { issuer: 'builder.ainative.studio' } },
        },
        {
          identifier: 'urn:air:builder.ainative.studio:docs:auth',
          displayName: 'AINative Builder agent registration guide',
          type: 'text/markdown',
          url: `${BASE_URL}/auth.md`,
          description: "AINative Builder's real auth flow for agents: NextAuth, backed by core's OAuth2.1/PKCE server.",
          representativeQueries: ['how does an agent authenticate with AINative Builder'],
          trustManifest: { identity: { issuer: 'builder.ainative.studio' } },
        },
        {
          identifier: 'urn:air:builder.ainative.studio:docs:skill',
          displayName: 'AINative Builder agent skill manifest',
          type: 'text/markdown',
          url: `${BASE_URL}/SKILL.md`,
          description: "AINative Builder's real agent-facing capabilities and the anonymous-build-then-claim provisioning flow.",
          representativeQueries: ['what can an agent do with AINative Builder'],
          trustManifest: { identity: { issuer: 'builder.ainative.studio' } },
        },
        {
          identifier: 'urn:air:builder.ainative.studio:provisioning',
          displayName: 'AINative Builder provisioning manifest (AR-PROV)',
          type: 'application/json',
          url: `${BASE_URL}/.well-known/provisioning`,
          description: 'AR-PROV agent provisioning readiness manifest for autonomously provisioning a company data layer on AINative Builder.',
          representativeQueries: ['can an agent autonomously provision an account on AINative Builder'],
          trustManifest: { identity: { issuer: 'builder.ainative.studio' } },
        },
      ],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
