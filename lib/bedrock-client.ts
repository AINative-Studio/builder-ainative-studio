/**
 * Minimal Amazon Bedrock client for Anthropic Claude models (builder Config C).
 *
 * Why a hand-rolled client instead of @anthropic-ai/bedrock-sdk:
 *   - The builder container authenticates to Bedrock with a BEARER TOKEN
 *     (AWS_BEARER_TOKEN_BEDROCK — the newer Bedrock API-key style), NOT SigV4
 *     access-key/secret pairs. The official bedrock-sdk assumes SigV4 signing and
 *     pulls in the AWS credential provider chain, which we neither have nor want.
 *   - The Bedrock runtime REST endpoint accepts a plain `Authorization: Bearer`
 *     header and the standard Anthropic messages payload
 *     ({anthropic_version, max_tokens, system, messages}). Verified live:
 *     POST /model/us.anthropic.claude-sonnet-4-5-20250929-v1:0/invoke -> HTTP 200.
 *
 * This client exposes a `.messages.create()` method whose signature and return
 * shape match the @anthropic-ai/sdk client the route already uses, so the call
 * site is a drop-in swap.
 */

export interface BedrockMessage {
  role: 'user' | 'assistant'
  content: string | any[]
}

export interface BedrockCreateParams {
  model?: string
  max_tokens: number
  system?: string
  messages: BedrockMessage[]
  temperature?: number
}

export interface BedrockUsage {
  input_tokens: number
  output_tokens: number
}

export interface BedrockResponse {
  content: Array<{ type: string; text?: string }>
  usage?: BedrockUsage
  stop_reason?: string
  model?: string
}

/**
 * Is Bedrock the configured primary completion provider? True only when the
 * explicit flag is set AND a bearer token is present. Anything else falls back
 * to the direct Anthropic API path (or AINative), so a half-configured
 * environment never silently breaks generation.
 */
export function isBedrockEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODY_USE_BEDROCK === '1' && !!env.AWS_BEARER_TOKEN_BEDROCK
}

/**
 * Resolve the Bedrock inference-profile model ID. The builder's ANTHROPIC_MODEL
 * may be either a bare model name (claude-sonnet-4-5-...) or an already-qualified
 * inference profile (us.anthropic....-v1:0). We normalize to the invoke-able
 * inference-profile form.
 */
export function resolveBedrockModelId(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.BEDROCK_MODEL_ID || '').trim()
  if (explicit) return explicit
  // Default to the verified working Sonnet 4.5 inference profile.
  return 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
}

class BedrockMessages {
  constructor(
    private readonly region: string,
    private readonly bearer: string,
    private readonly defaultModel: string,
  ) {}

  async create(params: BedrockCreateParams): Promise<BedrockResponse> {
    const model = params.model || this.defaultModel
    const url = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(
      model,
    )}/invoke`

    const body: Record<string, any> = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: params.max_tokens,
      messages: params.messages,
    }
    if (params.system) body.system = params.system
    if (typeof params.temperature === 'number') body.temperature = params.temperature

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.bearer}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Bedrock invoke failed: HTTP ${res.status} ${detail.slice(0, 200)}`)
    }

    const data: any = await res.json()
    return {
      content: Array.isArray(data.content) ? data.content : [],
      usage: data.usage
        ? {
            input_tokens: data.usage.input_tokens || 0,
            output_tokens: data.usage.output_tokens || 0,
          }
        : undefined,
      stop_reason: data.stop_reason,
      model: data.model,
    }
  }
}

/**
 * A Bedrock-backed client with a `.messages.create()` surface compatible with
 * the @anthropic-ai/sdk client used by the generation route.
 */
export class BedrockClient {
  readonly messages: BedrockMessages
  readonly modelId: string

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const region = env.AWS_REGION || 'us-east-1'
    const bearer = env.AWS_BEARER_TOKEN_BEDROCK || ''
    this.modelId = resolveBedrockModelId(env)
    this.messages = new BedrockMessages(region, bearer, this.modelId)
  }
}

let _bedrockClient: BedrockClient | null = null

/**
 * Lazily construct the shared Bedrock client, or return null when Bedrock is not
 * enabled/configured (caller then falls back to the direct Anthropic path).
 */
export function getBedrockClient(env: NodeJS.ProcessEnv = process.env): BedrockClient | null {
  if (!isBedrockEnabled(env)) return null
  if (_bedrockClient) return _bedrockClient
  _bedrockClient = new BedrockClient(env)
  return _bedrockClient
}
