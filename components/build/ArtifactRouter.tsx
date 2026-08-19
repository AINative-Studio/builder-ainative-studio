'use client'

/**
 * Artifact router (#220) — maps the current view id to its artifact screen.
 * App artifacts (#223), Company artifacts (#224), and late shared (#225) plug
 * in here. Until each is built, a generic ArtifactFrame renders the title +
 * status so the shell is navigable end-to-end.
 */

import { useBuild } from '@/contexts/build-context'
import { ArtifactFrame } from '@/components/build/ArtifactFrame'

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
  // Per-artifact rich screens land in #223/#224/#225; frame is the shared fallback.
  return <ArtifactFrame title={title} status={status} view={view} />
}
