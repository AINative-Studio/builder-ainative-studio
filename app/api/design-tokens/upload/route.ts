/**
 * Custom Design System Upload API (US-024)
 *
 * POST /api/design-tokens/upload
 *
 * Accepts:
 * - JSON file with design tokens
 * - CSS variables file
 *
 * Features:
 * - Parse tokens: colors (hex), typography (font-family, sizes), spacing (rem/px)
 * - Validate format: colors must be hex, sizes must have units
 * - Store per-user in database
 * - Generate preview with applied tokens
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/design-tokens/auth-helper'
import { createDesignToken, getDesignTokensByUserId } from '@/lib/db/queries'
import { validateDesignTokens } from '@/lib/design-tokens/validators'
import { parseJSONTokens, parseCSSVariables } from '@/lib/design-tokens/parsers'
import { DesignTokens } from '@/lib/design-tokens/types'
import { logger } from '@/lib/logger'

interface UploadRequest extends Partial<DesignTokens> {
  cssVariables?: string
  isActive?: boolean
}

// CSS parsing is now handled by the parsers module

/**
 * Generate preview HTML with applied tokens
 */
function generatePreview(tokens: DesignTokens): string {
  const { colors, typography, spacing } = tokens

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    :root {
      --color-primary: ${colors.primary};
      --color-secondary: ${colors.secondary};
      --color-accent: ${colors.accent};
      --font-family: ${typography.fontFamily};
      --font-base: ${typography.sizes.base};
      --spacing-base: ${spacing.baseUnit};
    }

    body {
      font-family: var(--font-family);
      font-size: var(--font-base);
      padding: calc(var(--spacing-base) * 4);
      background: #f5f5f5;
    }

    .preview-card {
      background: white;
      padding: calc(var(--spacing-base) * 6);
      border-radius: calc(var(--spacing-base) * 2);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      max-width: 600px;
      margin: 0 auto;
    }

    .preview-header {
      color: var(--color-primary);
      font-size: ${typography.sizes.xl || '1.25rem'};
      font-weight: 700;
      margin-bottom: calc(var(--spacing-base) * 4);
    }

    .preview-button {
      background: var(--color-primary);
      color: white;
      padding: calc(var(--spacing-base) * 2) calc(var(--spacing-base) * 4);
      border: none;
      border-radius: calc(var(--spacing-base) * 1);
      font-family: var(--font-family);
      cursor: pointer;
      margin-right: calc(var(--spacing-base) * 2);
    }

    .preview-button.secondary {
      background: var(--color-secondary);
    }

    .preview-button.accent {
      background: var(--color-accent);
    }

    .color-swatches {
      display: flex;
      gap: calc(var(--spacing-base) * 2);
      margin-top: calc(var(--spacing-base) * 4);
    }

    .color-swatch {
      width: 80px;
      height: 80px;
      border-radius: calc(var(--spacing-base) * 2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: ${typography.sizes.xs};
      color: white;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="preview-card">
    <h1 class="preview-header">Design Token Preview</h1>
    <p style="margin-bottom: calc(var(--spacing-base) * 4);">
      This preview demonstrates your custom design tokens in action.
    </p>
    <div>
      <button class="preview-button">Primary Button</button>
      <button class="preview-button secondary">Secondary</button>
      <button class="preview-button accent">Accent</button>
    </div>
    <div class="color-swatches">
      <div class="color-swatch" style="background: var(--color-primary)">Primary</div>
      <div class="color-swatch" style="background: var(--color-secondary)">Secondary</div>
      <div class="color-swatch" style="background: var(--color-accent)">Accent</div>
    </div>
  </div>
</body>
</html>
`.trim()
}

/**
 * Increment semver version
 */
function incrementVersion(version: string): string {
  const parts = version.split('.')
  if (parts.length !== 3) {
    return '1.0.1'
  }

  const [major, minor, patch] = parts.map(Number)
  return `${major}.${minor}.${patch + 1}`
}

export async function POST(req: NextRequest) {
  try {
    // Verify authentication
    const user = await getAuthenticatedUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized - please sign in' },
        { status: 401 }
      )
    }

    const userId = user.userId

    // Parse request body
    const body = await req.json() as UploadRequest

    if (!body.name) {
      return NextResponse.json(
        { error: 'Missing required field: name' },
        { status: 400 }
      )
    }

    if (!body.version) {
      return NextResponse.json(
        { error: 'Missing required field: version' },
        { status: 400 }
      )
    }

    // Parse tokens from either direct JSON or CSS variables
    let parsedTokens: DesignTokens | null = null

    if (body.cssVariables) {
      parsedTokens = parseCSSVariables(body.cssVariables) as DesignTokens
      if (!parsedTokens) {
        return NextResponse.json(
          { error: 'Failed to parse CSS variables' },
          { status: 400 }
        )
      }
    } else if (body.colors && body.typography && body.spacing) {
      // Direct token data
      parsedTokens = body as DesignTokens
    } else {
      return NextResponse.json(
        { error: 'Must provide either complete tokens or cssVariables' },
        { status: 400 }
      )
    }

    // Validate token format
    const validation = validateDesignTokens(parsedTokens)
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'Invalid token format',
          validationErrors: validation.errors,
        },
        { status: 400 }
      )
    }

    // Check if version already exists
    const existingTokens = await getDesignTokensByUserId(userId)
    const versionExists = existingTokens.some(
      (t) => t.name === body.name && t.version === body.version
    )

    if (versionExists) {
      return NextResponse.json(
        { error: `Version ${body.version} already exists for ${body.name}` },
        { status: 409 }
      )
    }

    // Create design token in database
    const [createdToken] = await createDesignToken({
      userId,
      name: body.name,
      tokens: parsedTokens,
      version: body.version,
      isActive: body.isActive || false,
    })

    // Generate preview HTML
    const previewHtml = generatePreview(parsedTokens)

    logger.info('Design token uploaded successfully', {
      userId,
      tokenId: createdToken.id,
      name: body.name,
      version: body.version,
      warnings: validation.warnings,
    })

    return NextResponse.json({
      success: true,
      token: {
        id: createdToken.id,
        name: createdToken.name,
        version: createdToken.version,
        isActive: createdToken.is_active,
        createdAt: createdToken.created_at,
      },
      preview: previewHtml,
      warnings: validation.warnings,
    })
  } catch (error) {
    logger.error('Design token upload failed', { error })
    return NextResponse.json(
      { error: 'Failed to upload design tokens' },
      { status: 500 }
    )
  }
}
