/**
 * Vercel Deployment Service (US-067)
 *
 * Provides one-click deployment to Vercel platform.
 * Uses Vercel REST API v13 for creating deployments.
 *
 * API Documentation: https://vercel.com/docs/rest-api/endpoints/deployments
 */

import { db } from '@/lib/db'
import { deployments, generations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getCredentialsWithFallback } from '../credentials.service'
import { exportProject } from '../export.service'

const VERCEL_API_URL = 'https://api.vercel.com'

/**
 * Deployment request structure
 */
export interface VercelDeploymentRequest {
  generationId: string
  userId: string
  projectName?: string
  teamId?: string // Optional Vercel team ID
}

/**
 * Vercel API file structure
 */
interface VercelFile {
  file: string
  data: string
}

/**
 * Vercel deployment response
 */
interface VercelDeploymentResponse {
  id: string
  url: string
  name: string
  status: 'READY' | 'BUILDING' | 'ERROR' | 'QUEUED' | 'CANCELED'
  readyState: 'READY' | 'BUILDING' | 'ERROR' | 'QUEUED' | 'CANCELED'
}

/**
 * Deploy a generated UI to Vercel
 * @param request - Deployment request parameters
 * @returns Deployment record
 */
export async function deployToVercel(
  request: VercelDeploymentRequest
): Promise<string> {
  const { generationId, userId, projectName, teamId } = request

  // Get Vercel API token
  const token = await getCredentialsWithFallback(
    userId,
    'vercel',
    'VERCEL_API_TOKEN'
  )

  if (!token) {
    throw new Error('Vercel API token not found. Please save your credentials first.')
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

  // Convert buffer to base64-encoded files for Vercel API
  const files = await convertProjectToVercelFiles(projectBuffer)

  // Determine project name
  const deploymentName = projectName || `ai-generated-${generationId.substring(0, 8)}`

  // Create deployment record in pending status
  const [deployment] = await db
    .insert(deployments)
    .values({
      user_id: userId,
      generation_id: generationId,
      platform: 'vercel',
      status: 'pending',
      metadata: {
        projectName: deploymentName,
      },
    })
    .returning()

  try {
    // Call Vercel API to create deployment
    const vercelResponse = await createVercelDeployment(
      token,
      deploymentName,
      files,
      teamId
    )

    // Update deployment record with Vercel deployment ID and URL
    await db
      .update(deployments)
      .set({
        deployment_id: vercelResponse.id,
        url: `https://${vercelResponse.url}`,
        status: mapVercelStatus(vercelResponse.status),
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
          projectName: deploymentName,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        updated_at: new Date(),
      })
      .where(eq(deployments.id, deployment.id))

    throw error
  }
}

/**
 * Convert exported project buffer to Vercel API file format
 */
async function convertProjectToVercelFiles(
  projectBuffer: Buffer
): Promise<VercelFile[]> {
  const AdmZip = require('adm-zip')
  const zip = new AdmZip(projectBuffer)
  const files: VercelFile[] = []

  const zipEntries = zip.getEntries()

  for (const entry of zipEntries) {
    if (!entry.isDirectory) {
      // Get file content as string or base64
      const content = entry.getData().toString('utf-8')

      files.push({
        file: entry.entryName,
        data: content,
      })
    }
  }

  return files
}

/**
 * Create deployment on Vercel using REST API v13
 */
async function createVercelDeployment(
  token: string,
  name: string,
  files: VercelFile[],
  teamId?: string
): Promise<VercelDeploymentResponse> {
  const url = teamId
    ? `${VERCEL_API_URL}/v13/deployments?teamId=${teamId}`
    : `${VERCEL_API_URL}/v13/deployments`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      files,
      projectSettings: {
        framework: 'nextjs',
        buildCommand: 'next build',
        outputDirectory: '.next',
        installCommand: 'npm install',
        devCommand: 'next dev',
      },
      target: 'production',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Vercel API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  return {
    id: data.id,
    url: data.url,
    name: data.name,
    status: data.readyState || 'QUEUED',
    readyState: data.readyState || 'QUEUED',
  }
}

/**
 * Map Vercel status to our deployment status
 */
function mapVercelStatus(
  vercelStatus: string
): 'pending' | 'building' | 'ready' | 'error' {
  switch (vercelStatus) {
    case 'READY':
      return 'ready'
    case 'BUILDING':
    case 'QUEUED':
      return 'building'
    case 'ERROR':
    case 'CANCELED':
      return 'error'
    default:
      return 'pending'
  }
}

/**
 * Get deployment status from Vercel
 * @param deploymentId - Vercel deployment ID
 * @param token - Vercel API token
 * @returns Current deployment status
 */
export async function getVercelDeploymentStatus(
  deploymentId: string,
  token: string
): Promise<{ status: string; url?: string }> {
  const response = await fetch(
    `${VERCEL_API_URL}/v13/deployments/${deploymentId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to get Vercel deployment status: ${response.status}`)
  }

  const data = await response.json()

  return {
    status: data.readyState,
    url: data.url ? `https://${data.url}` : undefined,
  }
}

/**
 * Cancel a Vercel deployment
 * @param deploymentId - Vercel deployment ID
 * @param token - Vercel API token
 */
export async function cancelVercelDeployment(
  deploymentId: string,
  token: string
): Promise<void> {
  const response = await fetch(
    `${VERCEL_API_URL}/v13/deployments/${deploymentId}/cancel`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to cancel Vercel deployment: ${response.status}`)
  }
}
