import { describe, it, expect } from 'vitest'
import { dataModelContextBlock } from '@/lib/build/data-model-context'

/**
 * Tests for lib/build/data-model-context.ts (#532) — the real, cheap wiring
 * of the founder-reviewed `dataModel` artifact into codegen's system prompt.
 * Must degrade to '' (no-op) on anything missing/malformed, never throw.
 */

describe('dataModelContextBlock', () => {
  it('returns empty string for undefined/null/non-object input', () => {
    expect(dataModelContextBlock(undefined)).toBe('')
    expect(dataModelContextBlock(null)).toBe('')
    expect(dataModelContextBlock('a string')).toBe('')
    expect(dataModelContextBlock(42)).toBe('')
  })

  it('returns empty string when entities is missing or not an array', () => {
    expect(dataModelContextBlock({})).toBe('')
    expect(dataModelContextBlock({ summary: 'a habit tracker' })).toBe('')
    expect(dataModelContextBlock({ entities: 'not-an-array' })).toBe('')
  })

  it('returns empty string when entities is an empty array', () => {
    expect(dataModelContextBlock({ entities: [] })).toBe('')
  })

  it('skips entities with a missing/blank name', () => {
    const block = dataModelContextBlock({
      entities: [{ name: '', fields: ['a'] }, { fields: ['b'] }, { name: '   ', fields: ['c'] }],
    })
    expect(block).toBe('')
  })

  it('formats a real dataModel artifact into an instruction block with entity + field names', () => {
    const block = dataModelContextBlock({
      summary: 'Tracks habits, daily check-ins, and streaks.',
      entities: [
        { name: 'Habit', fields: ['id: string', 'title: string', 'frequency: string'] },
        { name: 'CheckIn', fields: ['id: string', 'habitId: string', 'date: string', 'completed: boolean'] },
      ],
    })
    expect(block).toContain('USE THIS DATA MODEL')
    expect(block).toContain('Tracks habits, daily check-ins, and streaks.')
    expect(block).toContain('- Habit: id: string, title: string, frequency: string')
    expect(block).toContain('- CheckIn: id: string, habitId: string, date: string, completed: boolean')
    expect(block).toContain("don't invent an unrelated schema")
  })

  it('omits the summary line when summary is missing/blank', () => {
    const block = dataModelContextBlock({
      entities: [{ name: 'Task', fields: ['id: string'] }],
    })
    expect(block).not.toContain('undefined')
    expect(block).toContain('- Task: id: string')
  })

  it('handles an entity with no fields gracefully', () => {
    const block = dataModelContextBlock({
      entities: [{ name: 'Task', fields: [] }],
    })
    expect(block).toContain('- Task')
    expect(block).not.toContain('- Task:')
  })

  it('filters out non-string field entries without throwing', () => {
    const block = dataModelContextBlock({
      entities: [{ name: 'Task', fields: ['id: string', 42, null, 'title: string'] as any }],
    })
    expect(block).toContain('- Task: id: string, title: string')
  })

  it('is a small, bounded addition to the prompt (real cost-check, #532)', () => {
    // A realistic 6-entity dataModel (the schema's documented max) per
    // lib/build/artifact-prompts.ts's dataModel spec (3-6 entities).
    const entities = Array.from({ length: 6 }, (_, i) => ({
      name: `Entity${i}`,
      fields: ['id: string', 'name: string', 'createdAt: string', 'ownerId: string'],
    }))
    const block = dataModelContextBlock({ summary: 'A realistic multi-entity schema summary line.', entities })
    // Should stay well under 1.5KB even at the artifact's documented max size —
    // negligible next to the multi-KB PROFESSIONAL_SYSTEM_PROMPT it's appended to.
    expect(block.length).toBeLessThan(1500)
  })
})
