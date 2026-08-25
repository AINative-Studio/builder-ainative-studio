/**
 * Artifact generation prompts for the builder pivot (#207).
 *
 * Each artifact view (thesis, wedge, businessModel, prd, dataModel, …) turns the
 * USER'S IDEA into structured content via the platform chat-completions API
 * (claude-sonnet-4.5). The prompts here ask for STRICT JSON matching each
 * artifact's render shape, so the existing Modernist artifact layouts render
 * real, idea-specific content instead of the hardcoded knowledge-search mock.
 *
 * This mirrors what the browser agent-swarm does when it authors a PRD / data
 * model, but runs synchronously through chat-completions so it works for every
 * visitor (the swarm path is enterprise-gated — see core#6422).
 */

import { catalogPromptBlock } from './primitive-catalog'
import { codingStandardsContextBlock } from './coding-standards'

export interface ArtifactSpec {
  /** system prompt: the role/format contract */
  system: string
  /** build the user prompt from the idea + prior context */
  user: (ctx: ArtifactContext) => string
  /** JSON shape hint echoed to the model + used for validation */
  schemaHint: string
}

export interface ArtifactContext {
  idea: string
  track: 'app' | 'company'
  companyName?: string
  /** previously generated artifacts, keyed by view — lets later artifacts build on earlier ones */
  prior: Record<string, unknown>
  /**
   * The founder's content-language code (#57), e.g. 'es', 'pt-BR'. When set (and
   * non-English) the artifact route appends a languageInstruction to the system
   * prompt so the human-readable VALUES are generated in this language while JSON
   * keys / structure stay English (parseable). Absent → English (default).
   */
  contentLanguage?: string
}

const BASE_SYSTEM =
  'You are Cody, an AI technical co-founder inside AINative Builder. You turn a founder\'s raw idea ' +
  'into crisp, specific, investor-grade product and company artifacts. You NEVER return generic filler — ' +
  'every line is concrete to THIS idea. Return ONLY valid minified JSON matching the requested schema, ' +
  'no markdown, no prose outside the JSON. Keep strings tight (one or two sentences each).'

function ctxPreamble(ctx: ArtifactContext): string {
  const priorKeys = Object.keys(ctx.prior)
  const priorBlock = priorKeys.length
    ? `\n\nAlready decided (build on these, stay consistent):\n${JSON.stringify(ctx.prior).slice(0, 2000)}`
    : ''
  const name = ctx.companyName ? ` (working name: ${ctx.companyName})` : ''
  return `The founder's idea${name}:\n"""${ctx.idea}"""${priorBlock}\n\n`
}

export const ARTIFACT_PROMPTS: Record<string, ArtifactSpec> = {
  // ---- Company Track ----
  thesis: {
    system: BASE_SYSTEM,
    schemaHint: '{"meta":"str","problem":"str","problemTag":"str","who":"str","whoTag":"str","wedge":"str","whyNow":"str"}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the VENTURE THESIS. JSON keys: meta (one-line description of what this artifact is), ' +
      'problem (the core problem this idea solves), problemTag (e.g. "EVIDENCE · N interviews" or "ASSUMPTION · TBD"), ' +
      'who (who feels the pain most), whoTag, wedge (the sharpest starting point), whyNow (why this is viable now). ' +
      'Schema: {"meta","problem","problemTag","who","whoTag","wedge","whyNow"}',
  },
  wedge: {
    system: BASE_SYSTEM,
    schemaHint: '{"headline":"str","segment":"str","motion":"str","proofPlan":"str"}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the INITIAL WEDGE — the single narrowest beachhead to win first. JSON: ' +
      'headline (the wedge in one line), segment (exact customer segment), motion (how you reach + convert them), ' +
      'proofPlan (what proves the wedge works in 30 days). Schema: {"headline","segment","motion","proofPlan"}',
  },
  businessModel: {
    system: BASE_SYSTEM,
    schemaHint: '{"tiers":[{"plan":"str","price":"str","for":"str"}],"economics":["str"]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the BUSINESS MODEL. JSON: tiers (array of 2-4 {plan, price, for}), ' +
      'economics (array of 2-3 unit-economics bullets specific to this idea). ' +
      'Schema: {"tiers":[{"plan","price","for"}],"economics":[...]}',
  },
  positioning: {
    system: BASE_SYSTEM,
    schemaHint: '{"statement":"str","unlike":["str"]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write POSITIONING. JSON: statement (a sharp "for X, this is the Y that Z" positioning line), ' +
      'unlike (array of 3 "unlike the alternatives" contrasts). Schema: {"statement","unlike":[...]}',
  },
  landing: {
    system: BASE_SYSTEM,
    schemaHint: '{"eyebrow":"str","headline":"str","sub":"str","features":[{"h":"str","d":"str"}]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the LANDING PAGE hero. JSON: eyebrow (short uppercase kicker), headline (bold value prop, <=8 words), ' +
      'sub (one supporting sentence), features (array of exactly 3 {h, d}). Schema: {"eyebrow","headline","sub","features":[{"h","d"}]}',
  },
  plan30: {
    system: BASE_SYSTEM,
    schemaHint: '{"weeks":[{"w":"str","d":"str"}]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the 30-DAY PLAN. JSON: weeks (array of exactly 4 {w:"Week N", d:"concrete goal for that week"}). ' +
      'Make each week specific to this idea. Schema: {"weeks":[{"w","d"}]}',
  },

  // ---- App Track ----
  brief: {
    system: BASE_SYSTEM,
    schemaHint: '{"summary":"str","goals":["str"],"nonGoals":["str"],"users":["str"]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the PRODUCT BRIEF. JSON: summary (what we\'re building, one sentence), goals (3 bullets), ' +
      'nonGoals (2 bullets — explicitly out of scope for v1), users (2-3 target user types). ' +
      'Schema: {"summary","goals":[...],"nonGoals":[...],"users":[...]}',
  },
  prd: {
    system: BASE_SYSTEM,
    schemaHint: '{"overview":"str","features":[{"name":"str","desc":"str","priority":"str"}],"acceptance":["str"]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the PRODUCT REQUIREMENTS (PRD). JSON: overview (one paragraph), ' +
      'features (array of 4-6 {name, desc, priority:"P0"|"P1"|"P2"}), acceptance (3 acceptance criteria for v1). ' +
      'Schema: {"overview","features":[{"name","desc","priority"}],"acceptance":[...]}',
  },
  comp: {
    system: BASE_SYSTEM,
    schemaHint: '{"summary":"str","primitives":[{"name":"str","use":"str"}]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      // Inject the FULL machine-readable catalog + the idea-matched candidates
      // (#288) so the model chooses primitives THIS idea needs instead of
      // anchoring on a hardcoded shortlist (which collapsed every build onto the
      // same ~6). Source of truth: docs/AINATIVE_PRIMITIVES.md.
      catalogPromptBlock(ctx.idea, ctx.track) + '\n\n' +
      'Write the AINATIVE COMPOSITION PLAN — which of the above primitives this ' +
      (ctx.track === 'app' ? 'app' : 'company') + ' composes from. JSON: ' +
      'summary (one line), primitives (array of 3-6 {name, use:"how THIS idea uses it"}). ' +
      'Only include primitives the idea actually needs. Schema: {"summary","primitives":[{"name","use"}]}',
  },
  dataModel: {
    system: BASE_SYSTEM,
    schemaHint: '{"summary":"str","entities":[{"name":"str","fields":["str"]}]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the DATA MODEL. JSON: summary (one line), entities (array of 3-6 {name, fields:[field:type, ...]}) ' +
      'as ZeroDB tables for this idea. Schema: {"summary","entities":[{"name","fields":[...]}]}',
  },
  memoryPolicy: {
    system: BASE_SYSTEM,
    schemaHint: '{"summary":"str","rules":["str"]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the MEMORY POLICY (what the agent remembers via ZeroMemory + privacy rules). JSON: ' +
      'summary (one line), rules (3-4 bullets: what is remembered, retention, privacy). Schema: {"summary","rules":[...]}',
  },
  agentDef: {
    system: BASE_SYSTEM,
    schemaHint: '{"summary":"str","agents":[{"name":"str","role":"str"}]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the AGENT DEFINITION — the agents that run this product. JSON: summary (one line), ' +
      'agents (array of 2-4 {name, role}). Schema: {"summary","agents":[{"name","role"}]}',
  },
  codingStandards: {
    system: BASE_SYSTEM,
    schemaHint: '{"summary":"str","standards":[{"title":"str","rule":"str","applies":"str"}]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      // Ground the standards in the CANONICAL AINative set (mirrored from the
      // skills) so they are consistent across every idea, NOT hallucinated. The
      // model must keep the same rules; it only tailors `applies` to THIS app.
      'These are the AINative engineering standards Cody was trained to follow. Do NOT invent new ones or ' +
      'drop any — restate each one and add how it applies to THIS app.\n\n' +
      codingStandardsContextBlock() + '\n\n' +
      'Write the ENGINEERING STANDARDS / DEFINITION OF DONE for this app. JSON: summary (one line stating Cody ' +
      'builds this app to the AINative standards), standards (array with ONE entry per standard above, in the ' +
      'same order — {title (the standard), rule (the commitment), applies (one concrete sentence on how it applies ' +
      'to THIS app)}). Schema: {"summary","standards":[{"title","rule","applies"}]}',
  },
  apiSpec: {
    system: BASE_SYSTEM,
    schemaHint: '{"summary":"str","integrations":[{"name":"str","why":"str"}]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write INTEGRATIONS. JSON: summary (one line), integrations (array of 2-5 {name, why}). ' +
      'Schema: {"summary","integrations":[{"name","why"}]}',
  },
  backlog: {
    system: BASE_SYSTEM,
    schemaHint: '{"summary":"str","items":[{"title":"str","size":"str"}]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      'Write the BUILD BACKLOG. JSON: summary (one line), items (array of 5-8 {title, size:"S"|"M"|"L"}) ' +
      'in build order. Schema: {"summary","items":[{"title","size"}]}',
  },
  sprintPlan: {
    system: BASE_SYSTEM,
    schemaHint: '{"summary":"str","epics":[{"name":"str","goal":"str","issues":["str"]}],"firstSprint":["str"]}',
    user: (ctx) =>
      ctxPreamble(ctx) +
      // Turns the issues-only backlog into a real plan with EXPLICIT epics
      // (backlog has none today). Mirrors the company-track plan30 shape.
      'Write the SPRINT PLAN — organize the build into explicit EPICS, each with its issues, then scope the first ' +
      'sprint. JSON: summary (one line), epics (array of 2-4 {name (the epic), goal (what shipping it achieves), ' +
      'issues (2-4 concrete issue titles under this epic)}), firstSprint (array of 3-5 issue titles pulled from the ' +
      'epics that make up the first shippable sprint). Make everything specific to this app. ' +
      'Schema: {"summary","epics":[{"name","goal","issues":[...]}],"firstSprint":[...]}',
  },
}

/** Views that have a real generation prompt (others use their static/special body). */
export const GENERATED_VIEWS = new Set(Object.keys(ARTIFACT_PROMPTS))
