'use client'

/**
 * App Track artifact bodies (#223). Each renders inside ArtifactFrame's chrome
 * via the registry below. Copy + structure from 04-SCREENS §4–14. Kept as data-
 * driven sections so they stay terse and consistent with the Modernist system.
 */

import type { ReactNode } from 'react'

function Section({ h, children }: { h: string; children: ReactNode }) {
  return (
    <section className="m-sec">
      <h2 className="m-artifact m-sec-h">{h}</h2>
      <div className="m-sec-body">{children}</div>
    </section>
  )
}

function Tag({ kind, children }: { kind: 'assumption' | 'evidence'; children: ReactNode }) {
  return <span className={`m-inline-tag is-${kind} m-mono`}>{children}</span>
}

export const Brief = () => (
  <>
    <Section h="Overview">
      A private answer engine that replies from a team&apos;s own tools — with citations — so no one
      re-hunts for knowledge that already exists.
    </Section>
    <Section h="The problem">
      Teams drown in their own documents; answers exist but aren&apos;t findable. <Tag kind="assumption">ASSUMPTION · not yet validated</Tag>
    </Section>
    <Section h="Who it serves">
      Ops, support, and engineering teams at 50–500-person companies. <Tag kind="evidence">EVIDENCE · 3 interviews · draws from Customer Profile</Tag>
    </Section>
    <Section h="Core capabilities">
      <ul className="m-list"><li>Ask in natural language, get a cited answer</li><li>Pulls from connected tools (Drive, Slack, Jira)</li><li>Answers only from your data — never guesses</li></ul>
    </Section>
  </>
)

export const Prd = () => (
  <>
    <Section h="Goals & non-goals">
      <div className="m-two-col">
        <div><strong>Goals</strong><ul className="m-list"><li>Cited answers from connected sources</li><li>&lt;2s median response</li></ul></div>
        <div><strong>Non-goals</strong><ul className="m-list"><li>Public web search</li><li>Document editing</li></ul></div>
      </div>
    </Section>
    <Section h="User stories"><ul className="m-list"><li>As a support rep, I can ask a question and get a cited answer.</li><li>As an admin, I can control which sources are searchable.</li></ul></Section>
    <Section h="Acceptance criteria"><ul className="m-list m-checks"><li>Every answer shows at least one source citation</li><li>Abstains when confidence is low</li></ul></Section>
  </>
)

export const Comp = () => (
  <>
    <p className="m-sub">Each product requirement maps to an AINative primitive, and each primitive generates a real artifact you can open.</p>
    <table className="m-table">
      <thead><tr><th>Requirement</th><th>AINative primitive</th><th>Artifact</th></tr></thead>
      <tbody>
        <tr><td>Cited answers</td><td><span className="m-chip">ZeroDB · Vectors</span></td><td>Data Model</td></tr>
        <tr><td>Remember context</td><td><span className="m-chip">ZeroMemory</span></td><td>Memory Policy</td></tr>
        <tr><td>Answer engine</td><td><span className="m-chip">Agent Cloud</span></td><td>Agent Definition</td></tr>
        <tr><td>Tool access</td><td><span className="m-chip">MCP</span></td><td>Integrations</td></tr>
      </tbody>
    </table>
  </>
)

export const DataModel = () => (
  <>
    <p className="m-artifact-meta m-mono">ZeroDB · Vectors + Tables + managed embeddings</p>
    <div className="m-entity-grid">
      {[['Document', ['id · uuid', 'title · text', 'body · text', 'embedding · vector']],
        ['Person', ['id · uuid', 'name · text', 'role · text']],
        ['Query', ['id · uuid', 'text · text', 'answer · text', 'sources · uuid[]']]].map(([name, fields]) => (
        <div key={name as string} className="m-entity">
          <div className="m-entity-h m-mono">{name}</div>
          <ul className="m-entity-fields m-mono">{(fields as string[]).map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      ))}
    </div>
  </>
)

export const MemoryPolicy = () => (
  <table className="m-table">
    <thead><tr><th>What we remember</th><th>Retention</th><th>Scope</th><th>Who sees it</th></tr></thead>
    <tbody>
      <tr><td>Query history</td><td>90 days</td><td>Per user</td><td>The asker</td></tr>
      <tr><td>Source index</td><td>Until source removed</td><td>Workspace</td><td>Members</td></tr>
    </tbody>
  </table>
)

export const AgentDef = () => (
  <>
    <Section h="Role">A retrieval agent that answers strictly from connected sources, with citations.</Section>
    <Section h="Tools"><ul className="m-list m-mono"><li>ZeroDB.vectors.search(query, k) → GraphRAG passages</li><li>ZeroMemory.recall(userId) → prior context</li></ul></Section>
    <Section h="Guardrails"><ul className="m-list"><li>Cite or abstain — never guess.</li><li>Never expose sources the asker can&apos;t access.</li></ul></Section>
  </>
)

export const ApiSpec = () => (
  <>
    <p className="m-artifact-meta m-mono">Wired through MCP servers · external-tool calling</p>
    <Section h="Connectors"><ul className="m-list">{['Slack', 'Jira', 'Salesforce', 'Google Drive'].map((c) => <li key={c}>{c} <span className="st is-done">Wired</span></li>)}</ul></Section>
    <Section h="Endpoints"><ul className="m-list m-mono"><li>POST /ask — ask a question, get a cited answer</li><li>GET /sources/:id — fetch a cited source</li></ul></Section>
  </>
)

export const Backlog = () => (
  <>
    <p className="m-sub">Cody broke the PRD into shippable issues and assigned each to a swarm agent.</p>
    <table className="m-table">
      <thead><tr><th>Status</th><th>Issue</th><th>Agent</th></tr></thead>
      <tbody>
        {[['assigned', 'Vector search endpoint', 'Backend'], ['assigned', 'Citation renderer', 'Frontend'], ['assigned', 'Source-access guard', 'Security']].map(([s, t, a]) => (
          <tr key={t}><td><span className="st is-done">{s}</span></td><td>{t}</td><td className="m-mono">◇ {a}</td></tr>
        ))}
      </tbody>
    </table>
  </>
)

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

/** Registry consumed by ArtifactRouter. */
export const APP_ARTIFACT_BODIES: Record<string, () => ReactNode> = {
  brief: Brief, prd: Prd, comp: Comp, dataModel: DataModel, memoryPolicy: MemoryPolicy,
  agentDef: AgentDef, apiSpec: ApiSpec, backlog: Backlog, infra: Infra,
}
