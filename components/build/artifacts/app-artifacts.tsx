'use client'

/**
 * App Track artifact bodies (#223, wired #207).
 *
 * Each renders REAL generated content from state.generated[view] (produced by
 * /api/build/artifact from the founder's idea), with a shimmer while pending and
 * a static example on failure so the shell never looks broken. Structure/classes
 * from 04-SCREENS §4–14.
 */

import type { ReactNode } from 'react'
import { Section, Tag, Generating, GenError, useGen } from '@/components/build/artifacts/gen-helpers'
import { CODING_STANDARDS } from '@/lib/build/coding-standards'

export const Brief = () => {
  const { data, error } = useGen<{ summary: string; goals: string[]; nonGoals: string[]; users: string[] }>('brief')
  if (!data && !error) return <Generating lines={5} />
  const d = data ?? {
    summary: 'A private answer engine that replies from a team\'s own tools — with citations.',
    goals: ['Cited answers from connected sources', '<2s median response'],
    nonGoals: ['Public web search', 'Document editing'],
    users: ['Ops teams', 'Support teams', 'Engineering teams'],
  }
  return (
    <>
      {error && <GenError error={error} />}
      <Section h="Overview">{d.summary}</Section>
      <Section h="Goals"><ul className="m-list">{(d.goals || []).map((g, i) => <li key={i}>{g}</li>)}</ul></Section>
      <Section h="Non-goals"><ul className="m-list">{(d.nonGoals || []).map((g, i) => <li key={i}>{g}</li>)}</ul></Section>
      <Section h="Who it serves">
        <ul className="m-list">{(d.users || []).map((u, i) => <li key={i}>{u}</li>)}</ul>
        <Tag kind="assumption">ASSUMPTION · sizing TBD</Tag>
      </Section>
    </>
  )
}

export const Prd = () => {
  const { data, error } = useGen<{ overview: string; features: Array<{ name: string; desc: string; priority: string }>; acceptance: string[] }>('prd')
  if (!data && !error) return <Generating lines={6} />
  const d = data ?? {
    overview: 'A cited answer engine over a team\'s connected tools.',
    features: [
      { name: 'Cited answers', desc: 'Every answer shows its sources', priority: 'P0' },
      { name: 'Source controls', desc: 'Admins choose searchable sources', priority: 'P1' },
    ],
    acceptance: ['Every answer shows at least one source citation', 'Abstains when confidence is low'],
  }
  return (
    <>
      {error && <GenError error={error} />}
      <Section h="Overview">{d.overview}</Section>
      <Section h="Features">
        <table className="m-table">
          <thead><tr><th>Feature</th><th>Description</th><th>Priority</th></tr></thead>
          <tbody>
            {(d.features || []).map((f, i) => (
              <tr key={i}><td>{f.name}</td><td>{f.desc}</td><td><span className="m-chip">{f.priority}</span></td></tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section h="Acceptance criteria"><ul className="m-list m-checks">{(d.acceptance || []).map((a, i) => <li key={i}>{a}</li>)}</ul></Section>
    </>
  )
}

export const Comp = () => {
  const { data, error } = useGen<{ summary: string; primitives: Array<{ name: string; use: string }> }>('comp')
  if (!data && !error) return <Generating lines={4} />
  const d = data ?? {
    summary: 'Each requirement maps to an AINative primitive.',
    primitives: [
      { name: 'ZeroDB · Vectors', use: 'Cited retrieval over your data' },
      { name: 'ZeroMemory', use: 'Remember context per user' },
      { name: 'Agent Cloud', use: 'Run the answer agent' },
      { name: 'MCP', use: 'Tool access to connected apps' },
    ],
  }
  return (
    <>
      {error && <GenError error={error} />}
      <p className="m-sub">{d.summary}</p>
      <table className="m-table">
        <thead><tr><th>AINative primitive</th><th>How this app uses it</th></tr></thead>
        <tbody>
          {(d.primitives || []).map((p, i) => (
            <tr key={i}><td><span className="m-chip">{p.name}</span></td><td>{p.use}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export const DataModel = () => {
  const { data, error } = useGen<{ summary: string; entities: Array<{ name: string; fields: string[] }> }>('dataModel')
  if (!data && !error) return <Generating lines={5} />
  const d = data ?? {
    summary: 'ZeroDB · Vectors + Tables + managed embeddings',
    entities: [
      { name: 'Document', fields: ['id · uuid', 'title · text', 'body · text', 'embedding · vector'] },
      { name: 'Person', fields: ['id · uuid', 'name · text', 'role · text'] },
      { name: 'Query', fields: ['id · uuid', 'text · text', 'answer · text', 'sources · uuid[]'] },
    ],
  }
  return (
    <>
      {error && <GenError error={error} />}
      <p className="m-artifact-meta m-mono">{d.summary}</p>
      <div className="m-entity-grid">
        {(d.entities || []).map((e, i) => (
          <div key={i} className="m-entity">
            <div className="m-entity-h m-mono">{e.name}</div>
            <ul className="m-entity-fields m-mono">{(e.fields || []).map((f, j) => <li key={j}>{f}</li>)}</ul>
          </div>
        ))}
      </div>
    </>
  )
}

export const MemoryPolicy = () => {
  const { data, error } = useGen<{ summary: string; rules: string[] }>('memoryPolicy')
  if (!data && !error) return <Generating lines={4} />
  const d = data ?? { summary: 'What the agent remembers via ZeroMemory.', rules: ['Query history · 90 days · per user', 'Source index · until removed · workspace'] }
  return (
    <>
      {error && <GenError error={error} />}
      <p className="m-artifact-meta m-mono">{d.summary}</p>
      <ul className="m-list">{(d.rules || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
    </>
  )
}

export const AgentDef = () => {
  const { data, error } = useGen<{ summary: string; agents: Array<{ name: string; role: string }> }>('agentDef')
  if (!data && !error) return <Generating lines={4} />
  const d = data ?? {
    summary: 'The agents that run this product.',
    agents: [{ name: 'Answer agent', role: 'Answers strictly from connected sources, with citations' }],
  }
  return (
    <>
      {error && <GenError error={error} />}
      <Section h="Summary">{d.summary}</Section>
      <Section h="Agents"><ul className="m-list">{(d.agents || []).map((a, i) => <li key={i}><strong>{a.name}</strong> — {a.role}</li>)}</ul></Section>
    </>
  )
}

export const CodingStandards = () => {
  const { data, error } = useGen<{ summary: string; standards: Array<{ title: string; rule: string; applies?: string }> }>('codingStandards')
  if (!data && !error) return <Generating lines={6} />
  // Fallback mirrors the CANONICAL standards so the artifact is grounded even
  // when generation is unavailable — the standards are never invented per-idea.
  const d: { summary: string; standards: Array<{ title: string; rule: string; applies?: string }> } = data ?? {
    summary: 'Cody builds this app to the AINative engineering standards — the same Definition of Done he was trained on.',
    standards: CODING_STANDARDS.map((s) => ({ title: s.title, rule: s.rule })),
  }
  return (
    <>
      {error && <GenError error={error} />}
      <p className="m-sub">{d.summary}</p>
      <ul className="m-list m-checks">
        {(d.standards || []).map((s, i) => (
          <li key={i}>
            <strong>{s.title}</strong> — {s.rule}
            {s.applies && <> <Tag kind="evidence">{s.applies}</Tag></>}
          </li>
        ))}
      </ul>
    </>
  )
}

export const SprintPlan = () => {
  const { data, error } = useGen<{ summary: string; epics: Array<{ name: string; goal: string; issues: string[] }>; firstSprint: string[] }>('sprintPlan')
  if (!data && !error) return <Generating lines={6} />
  const d = data ?? {
    summary: 'Cody grouped the backlog into epics and scoped the first sprint.',
    epics: [
      { name: 'Retrieval core', goal: 'Cited answers over connected data', issues: ['Vector search endpoint', 'Citation renderer'] },
      { name: 'Access control', goal: 'Only authorized sources are searchable', issues: ['Source-access guard', 'Admin source controls'] },
    ],
    firstSprint: ['Vector search endpoint', 'Citation renderer', 'Source-access guard'],
  }
  return (
    <>
      {error && <GenError error={error} />}
      <p className="m-sub">{d.summary}</p>
      <Section h="Epics">
        <div className="m-entity-grid">
          {(d.epics || []).map((e, i) => (
            <div key={i} className="m-entity">
              <div className="m-entity-h m-mono">{e.name}</div>
              <p className="m-artifact-meta">{e.goal}</p>
              <ul className="m-entity-fields">{(e.issues || []).map((iss, j) => <li key={j}>{iss}</li>)}</ul>
            </div>
          ))}
        </div>
      </Section>
      <Section h="First sprint">
        <ul className="m-list m-checks">{(d.firstSprint || []).map((iss, i) => <li key={i}>{iss}</li>)}</ul>
      </Section>
    </>
  )
}

export const ApiSpec = () => {
  const { data, error } = useGen<{ summary: string; integrations: Array<{ name: string; why: string }> }>('apiSpec')
  if (!data && !error) return <Generating lines={4} />
  const d = data ?? {
    summary: 'Wired through MCP servers · external-tool calling',
    integrations: [{ name: 'Slack', why: 'Read team knowledge' }, { name: 'Google Drive', why: 'Index documents' }],
  }
  return (
    <>
      {error && <GenError error={error} />}
      <p className="m-artifact-meta m-mono">{d.summary}</p>
      <ul className="m-list">{(d.integrations || []).map((c, i) => <li key={i}>{c.name} — {c.why} <span className="st is-done">Wired</span></li>)}</ul>
    </>
  )
}

export const Backlog = () => {
  const { data, error } = useGen<{ summary: string; items: Array<{ title: string; size: string }> }>('backlog')
  if (!data && !error) return <Generating lines={6} />
  const d = data ?? {
    summary: 'Cody broke the PRD into shippable issues.',
    items: [{ title: 'Vector search endpoint', size: 'M' }, { title: 'Citation renderer', size: 'S' }, { title: 'Source-access guard', size: 'M' }],
  }
  const agents = ['Backend', 'Frontend', 'Security', 'Data', 'QA']
  return (
    <>
      {error && <GenError error={error} />}
      <p className="m-sub">{d.summary}</p>
      <table className="m-table">
        <thead><tr><th>Status</th><th>Issue</th><th>Size</th><th>Agent</th></tr></thead>
        <tbody>
          {(d.items || []).map((it, i) => (
            <tr key={i}><td><span className="st is-done">assigned</span></td><td>{it.title}</td><td><span className="m-chip">{it.size}</span></td><td className="m-mono">◇ {agents[i % agents.length]}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

// Infra stays a static "provisioning" checklist — it's not idea-specific prose.
export const Infra = () => (
  <>
    <p className="m-artifact-meta m-mono">Real AINative primitives · provision everything, ask nothing</p>
    <ul className="m-list m-checklist">
      {[['ZeroDB project', 'vectors + tables + embeddings'], ['ZeroMemory namespace', 'per-workspace isolation'], ['Agent Cloud deploy', 'answer agent, auto-scale'], ['Identity', 'OAuth 2.1 + PKCE']].map(([n, d]) => (
        <li key={n}><span className="st is-done" /> <strong>{n}</strong> <span className="m-mono m-muted">{d}</span></li>
      ))}
    </ul>
  </>
)

export const APP_ARTIFACT_BODIES: Record<string, () => ReactNode> = {
  brief: Brief, prd: Prd, comp: Comp, dataModel: DataModel, memoryPolicy: MemoryPolicy,
  agentDef: AgentDef, codingStandards: CodingStandards, apiSpec: ApiSpec,
  backlog: Backlog, sprintPlan: SprintPlan, infra: Infra,
}
