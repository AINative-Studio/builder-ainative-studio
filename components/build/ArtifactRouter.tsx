'use client'

/**
 * Artifact router (#220) — maps the current view id to its artifact screen.
 * App artifacts (#223), Company artifacts (#224), and late shared (#225) plug
 * in here. Until each is built, a generic ArtifactFrame renders the title +
 * status so the shell is navigable end-to-end.
 */

import { useBuild } from '@/contexts/build-context'
import { ArtifactFrame } from '@/components/build/ArtifactFrame'
import { APP_ARTIFACT_BODIES } from '@/components/build/artifacts/app-artifacts'
import { COMPANY_ARTIFACT_BODIES } from '@/components/build/artifacts/company-artifacts'
import { Swarm } from '@/components/build/artifacts/Swarm'
import { Preview } from '@/components/build/artifacts/Preview'
import { Wedge } from '@/components/build/artifacts/Wedge'
import { Pipeline } from '@/components/build/artifacts/Pipeline'
import { Conflict } from '@/components/build/artifacts/Conflict'
import { Graph } from '@/components/build/artifacts/Graph'
import { RescopeIntent } from '@/components/build/artifacts/RescopeIntent'
import { ARTIFACT_TITLES } from '@/lib/build/titles'

const SPECIAL_BODIES: Record<string, () => React.ReactNode> = {
  swarm: Swarm,
  preview: Preview,
  wedge: Wedge,
  pipeline: Pipeline,
  'rescope-intent': RescopeIntent,
  conflict: Conflict,
  graph: Graph,
}

export function ArtifactRouter({ view }: { view: string }) {
  const { state } = useBuild()
  const title = ARTIFACT_TITLES[view] ?? view
  const status = state.done[view] ?? (state.building ? 'building' : 'queued')
  const Body = SPECIAL_BODIES[view] ?? APP_ARTIFACT_BODIES[view] ?? COMPANY_ARTIFACT_BODIES[view]
  // key={view} (#329): ArtifactFrame holds per-view UI state (edit drafts,
  // feedback text, regenerating). Without a key React preserves the instance
  // across view navigation — a PRD edit draft could be saved into another
  // artifact. Remount per view so that state can never carry over.
  return (
    <ArtifactFrame key={view} title={title} status={status} view={view}>
      {Body ? <Body /> : undefined}
    </ArtifactFrame>
  )
}
