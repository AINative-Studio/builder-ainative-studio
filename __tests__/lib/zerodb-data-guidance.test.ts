import { describe, it, expect } from 'vitest'
import { PROFESSIONAL_SYSTEM_PROMPT } from '@/lib/professional-prompt'

/**
 * Per directive: generated apps must persist via the ZeroDB serverless proxy
 * (/api/db/{table}), NEVER a dedicated Postgres/backend DB.
 */
describe('ZeroDB data-layer guidance in system prompt', () => {
  it('instructs apps to use the /api/db ZeroDB serverless endpoints', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/\/api\/db\/\{table\}/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/ZeroDB/i)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/serverless/i)
  })

  it('shows the CRUD verbs (GET/POST/PUT/DELETE) against /api/db', () => {
    const flat = PROFESSIONAL_SYSTEM_PROMPT.replace(/\s+/g, ' ')
    for (const verb of ['GET', 'POST', 'PUT', 'DELETE']) {
      expect(flat).toMatch(new RegExp(`${verb}\\s+.*\\/api\\/db`))
    }
  })

  it('explicitly forbids dedicated databases / backend servers', () => {
    const flat = PROFESSIONAL_SYSTEM_PROMPT.replace(/\s+/g, ' ')
    expect(flat).toMatch(/NEVER.*(dedicated database|postgres|new Pool|Prisma|Drizzle|Supabase|Firebase|Mongo)/i)
    expect(flat).toMatch(/never write a backend server|provision a database/i)
  })

  it('allows in-memory state for purely presentational apps (no forced data layer)', () => {
    // text may wrap across lines — normalize whitespace before matching
    const flat = PROFESSIONAL_SYSTEM_PROMPT.replace(/\s+/g, ' ')
    expect(flat).toMatch(/do NOT force a data layer/i)
    expect(flat).toMatch(/purely presentational/i)
  })
})
