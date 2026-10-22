/**
 * The set of artifact view names that have a real generation prompt in
 * artifact-prompts.ts (others use their static/special body).
 *
 * This is deliberately its own module with zero imports (#1200).
 * useAutoplay.ts and components/build/ArtifactFrame.tsx only ever needed
 * this one Set<string> of ~16 keys, but importing it from
 * artifact-prompts.ts dragged in that file's full module graph —
 * primitive-catalog.ts (1795 lines) plus primitive-graph.ts, capabilities.ts,
 * and coding-standards.ts — for every jsdom test that renders a component
 * touching either hook or ArtifactFrame. artifact-prompts.ts re-exports this
 * same constant for backward compatibility with existing callers/tests.
 *
 * Keep this list in sync with ARTIFACT_PROMPTS's keys in artifact-prompts.ts
 * (there is no mechanical way to derive one from the other without
 * reintroducing the import this module exists to avoid).
 */
export const GENERATED_VIEWS: ReadonlySet<string> = new Set([
  'thesis',
  'wedge',
  'businessModel',
  'positioning',
  'landing',
  'plan30',
  'brief',
  'prd',
  'comp',
  'dataModel',
  'memoryPolicy',
  'agentDef',
  'codingStandards',
  'apiSpec',
  'backlog',
  'sprintPlan',
])
