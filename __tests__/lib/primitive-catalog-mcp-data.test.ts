/**
 * #343 — MCP real-data provisioning prompt blocks.
 *
 * mcpDataProvisioningBlock is the agent-prompt paragraph instructing Cody to
 * create real ZeroDB tables + seed 5-10 realistic records via mcp__zerodb__*
 * for data-backed apps. codegenCompositionBlock (all codegen paths) gains the
 * "seeded rows are the source of truth — don't hardcode mock arrays" note.
 */
import { describe, it, expect } from 'vitest'
import { mcpDataProvisioningBlock, codegenCompositionBlock } from '@/lib/build/primitive-catalog'

describe('mcpDataProvisioningBlock (#343)', () => {
  const block = mcpDataProvisioningBlock()

  it('names the exact MCP tools the agent has wired (server key `zerodb`)', () => {
    // buildAgentMcpWiring registers the server as `zerodb`, and the
    // ainative-zerodb-mcp-server tool names are zerodb_create_table /
    // zerodb_insert_rows — so the fully-qualified names are:
    expect(block).toContain('mcp__zerodb__zerodb_create_table')
    expect(block).toContain('mcp__zerodb__zerodb_insert_rows')
  })

  it('mandates 5-10 realistic seeded records, not test filler', () => {
    expect(block).toContain('5-10')
    expect(block.toLowerCase()).toContain('realistic')
    expect(block).toMatch(/"Test 1"|"foo"/)
  })

  it('binds table names to the /api/db/{table} segments the app uses', () => {
    expect(block).toContain('/api/db/{table}')
    expect(block).toContain('table_name')
  })

  it('forbids hardcoding the seeded data in app code (runtime reads win)', () => {
    expect(block).toContain('Do NOT hardcode')
    expect(block).toContain('GET /api/db/{table}')
  })

  it('explains project scoping (company project when provisioned, else shared preview)', () => {
    expect(block.toLowerCase()).toContain('shared preview zerodb project')
    // attempt-once discipline (verifier critical): failing MCP calls must never loop
    expect(block).toContain('do NOT retry it more than once')
  })

  it('allows a skip only for apps that persist nothing', () => {
    expect(block).toContain('Skip this ONLY')
  })
})

describe('codegenCompositionBlock seeded-data note (#343)', () => {
  it('tells every codegen path that seeded rows are the source of truth', () => {
    const block = codegenCompositionBlock('a todo list app to manage tasks', 'app')
    expect(block).toContain('MAY be pre-seeded')
    expect(block).toContain('Do NOT ship a hardcoded mock array')
  })

  it('does not tell the plain (tool-less) codegen model to call MCP tools', () => {
    // MCP tool-call instructions belong ONLY in the agent prompt (where the
    // tools exist) — in a plain completion they become hallucinated syntax.
    const block = codegenCompositionBlock('a todo list app to manage tasks', 'app')
    expect(block).not.toContain('mcp__zerodb__')
  })
})
