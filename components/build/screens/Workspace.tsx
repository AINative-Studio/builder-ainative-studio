'use client'

/**
 * Workspace router (#220) — renders the shell + the current artifact view.
 * Individual artifact screens (#223 App, #224 Company, #225 late) plug into
 * the ArtifactRouter. For now the shell + a generic artifact frame render;
 * per-artifact content is filled in by subsequent issues.
 */

import { useBuild } from '@/contexts/build-context'
import { WorkspaceShell } from '@/components/build/WorkspaceShell'
import { CodyFeed } from '@/components/build/CodyFeed'
import { PoweringThis } from '@/components/build/PoweringThis'
import { ArtifactRouter } from '@/components/build/ArtifactRouter'

export function Workspace() {
  const { state } = useBuild()
  return (
    <WorkspaceShell feed={<CodyFeed />}>
      <PoweringThis view={state.view} />
      <ArtifactRouter view={state.view} />
    </WorkspaceShell>
  )
}
