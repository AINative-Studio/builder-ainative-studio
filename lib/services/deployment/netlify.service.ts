/**
 * Netlify Deployment Service (US-068)
 *
 * Provides one-click deployment to Netlify platform.
 * Uses Netlify REST API for creating sites and deployments.
 *
 * API Documentation: https://docs.netlify.com/api/get-started/
 */

import { db } from '@/lib/db'
import { deployments, generations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getCredentialsWithFallback } from '../credentials.service'
import { exportProject } from '../export.service'
import FormData from 'form-data'

const NETLIFY_API_URL = 'https://api.netlify.com/api/v1'

/**
 * Deployment request structure
 */
export interface NetlifyDeploymentRequest {
  generationId: string
  userId: string
  siteName?: string
}

/**
 * Netlify site creation response
 */
interface NetlifySiteResponse {
  id: string
  name: string
  url: string
  admin_url: string
  ssl_url: string
}

/**
 * Netlify deployment response
 */
interface NetlifyDeployResponse {
  id: string
  site_id: string
  state: 'ready' | 'building' | 'error' | 'processing' | 'uploaded'
  url: string
  ssl_url: string
}

/**
 * Deploy a generated UI to Netlify
 * @param request - Deployment request parameters
 * @returns Deployment record ID
 */
export async function deployToNetlify(
  request: NetlifyDeploymentRequest
): Promise<string> {
  const { generationId, userId, siteName } = request

  // Get Netlify API token
  const token = await getCredentialsWithFallback(
    userId,
    'netlify',
    'NETLIFY_API_TOKEN'
  )

  if (!token) {
    throw new Error('Netlify API token not found. Please save your credentials first.')
  }

  // Fetch generation from database
  const result = await db
    .select()
    .from(generations)
    .where(eq(generations.id, generationId))
    .limit(1)

  if (result.length === 0) {
    throw new Error('Generation not found')
  }

  const generation = result[0]

  // Authorization check
  if (generation.user_id !== userId) {
    throw new Error('Unauthorized access to generation')
  }

  // Get exported project as buffer
  const projectBuffer = await exportProject(generationId)

  // Determine site name
  const deploymentSiteName =
    siteName || `ai-generated-${generationId.substring(0, 8)}`

  // Create deployment record in pending status
  const [deployment] = await db
    .insert(deployments)
    .values({
      user_id: userId,
      generation_id: generationId,
      platform: 'netlify',
      status: 'pending',
      metadata: {
        projectName: deploymentSiteName,
      },
    })
    .returning()

  try {
    // Step 1: Create a new site on Netlify
    const site = await createNetlifySite(token, deploymentSiteName)

    // Step 2: Upload the project as a zip file
    const deployResponse = await uploadToNetlify(
      token,
      site.id,
      projectBuffer
    )

    // Update deployment record with Netlify deployment ID and URL
    await db
      .update(deployments)
      .set({
        deployment_id: deployResponse.id,
        url: deployResponse.ssl_url || deployResponse.url,
        status: mapNetlifyStatus(deployResponse.state),
        metadata: {
          projectName: deploymentSiteName,
          siteId: site.id,
        },
        updated_at: new Date(),
      })
      .where(eq(deployments.id, deployment.id))

    return deployment.id
  } catch (error) {
    // Update deployment record with error status
    await db
      .update(deployments)
      .set({
        status: 'error',
        metadata: {
          projectName: deploymentSiteName,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        updated_at: new Date(),
      })
      .where(eq(deployments.id, deployment.id))

    throw error
  }
}

/**
 * Create a new site on Netlify
 */
async function createNetlifySite(
  token: string,
  name: string
): Promise<NetlifySiteResponse> {
  const response = await fetch(`${NETLIFY_API_URL}/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      custom_domain: null,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Netlify site creation error (${response.status}): ${errorText}`)
  }

  return await response.json()
}

/**
 * Upload project zip to Netlify site
 */
async function uploadToNetlify(
  token: string,
  siteId: string,
  projectBuffer: Buffer
): Promise<NetlifyDeployResponse> {
  // Create form data with the zip file
  const formData = new FormData()
  formData.append('file', projectBuffer, {
    filename: 'deploy.zip',
    contentType: 'application/zip',
  })

  const response = await fetch(`${NETLIFY_API_URL}/sites/${siteId}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...formData.getHeaders(),
    },
    body: formData as any,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Netlify upload error (${response.status}): ${errorText}`)
  }

  return await response.json()
}

/**
 * Map Netlify status to our deployment status
 */
function mapNetlifyStatus(
  netlifyStatus: string
): 'pending' | 'building' | 'ready' | 'error' {
  switch (netlifyStatus) {
    case 'ready':
      return 'ready'
    case 'building':
    case 'processing':
    case 'uploaded':
      return 'building'
    case 'error':
      return 'error'
    default:
      return 'pending'
  }
}

/**
 * Get deployment status from Netlify
 * @param deploymentId - Netlify deployment ID
 * @param token - Netlify API token
 * @returns Current deployment status
 */
export async function getNetlifyDeploymentStatus(
  deploymentId: string,
  token: string
): Promise<{ status: string; url?: string }> {
  const response = await fetch(
    `${NETLIFY_API_URL}/deploys/${deploymentId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to get Netlify deployment status: ${response.status}`)
  }

  const data = await response.json()

  return {
    status: data.state,
    url: data.ssl_url || data.url,
  }
}

/**
 * Delete a Netlify site
 * @param siteId - Netlify site ID
 * @param token - Netlify API token
 */
export async function deleteNetlifySite(
  siteId: string,
  token: string
): Promise<void> {
  const response = await fetch(`${NETLIFY_API_URL}/sites/${siteId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to delete Netlify site: ${response.status}`)
  }
}

/**
 * List all sites for a user
 * @param token - Netlify API token
 * @returns Array of sites
 */
export async function listNetlifySites(
  token: string
): Promise<NetlifySiteResponse[]> {
  const response = await fetch(`${NETLIFY_API_URL}/sites`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to list Netlify sites: ${response.status}`)
  }

  return await response.json()
}
