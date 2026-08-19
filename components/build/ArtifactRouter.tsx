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

const SPECIAL_BODIES: Record<string, () => React.ReactNode> = {
  swarm: Swarm,
  preview: Preview,
  wedge: Wedge,
  pipeline: Pipeline,
  conflict: Conflict,
  graph: Graph,
}

const TITLES: Record<string, string> = {
  brief: 'Product Brief', prd: 'Product Requirements', comp: 'AINative Composition Plan',
  dataModel: 'Data Model', memoryPolicy: 'Memory Policy', agentDef: 'Agent Definition',
  apiSpec: 'Integrations', backlog: 'Build Backlog', swarm: 'The swarm',
  infra: 'Infrastructure', preview: 'Running Preview',
  thesis: 'Venture Thesis', wedge: 'Initial Wedge', businessModel: 'Business Model',
  positioning: 'Positioning', landing: 'Landing Page', plan30: '30-Day Plan',
  pipeline: 'Sales Pipeline', conflict: 'Dependency Conflict', graph: 'The artifact graph',
}

export function ArtifactRouter({ view }: { view: string }) {
  const { state } = useBuild()
  const title = TITLES[view] ?? view
  const status = state.done[view] ?? (state.building ? 'building' : 'queued')
  const Body = SPECIAL_BODIES[view] ?? APP_ARTIFACT_BODIES[view] ?? COMPANY_ARTIFACT_BODIES[view]
  return (
    <ArtifactFrame title={title} status={status} view={view}>
      {Body ? <Body /> : undefined}
    </ArtifactFrame>
  )
}
