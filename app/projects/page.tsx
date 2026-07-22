import { redirect } from 'next/navigation'
import { auth } from '@/app/(auth)/auth'
import { ProjectsClient } from './projects-client'

export const dynamic = 'force-dynamic'

/**
 * Projects = generated apps, scoped to the active AINative workspace.
 * Each project maps 1:1 to a generated app (project.organization_id -> workspace).
 */
export default async function ProjectsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const isAINative = (session as any)?.accessToken != null
  return <ProjectsClient isAINative={isAINative} />
}
