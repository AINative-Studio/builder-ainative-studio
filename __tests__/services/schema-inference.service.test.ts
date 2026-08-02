import { describe, it, expect } from 'vitest'
import {
  inferSchema,
  extractEntities,
  detectAuthRequirement,
  detectVectorRequirement,
  toSnakeCase,
  singularize,
  pluralize,
  describeSchema,
} from '@/lib/services/schema-inference.service'

/**
 * Unit tests for the pure schema-inference layer (Issue #36).
 * These cover the deterministic prompt -> data-model transformation that drives
 * full-stack backend provisioning.
 */
describe('schema-inference: helpers', () => {
  describe('toSnakeCase', () => {
    it('lowercases and snake-cases camelCase', () => {
      expect(toSnakeCase('BlogPost')).toBe('blog_post')
      expect(toSnakeCase('userProfile')).toBe('user_profile')
    })
    it('collapses spaces and hyphens', () => {
      expect(toSnakeCase('  order   items ')).toBe('order_items')
      expect(toSnakeCase('to-do-list')).toBe('to_do_list')
    })
    it('strips invalid characters', () => {
      expect(toSnakeCase('price$ (usd)')).toBe('price_usd')
    })
  })

  describe('pluralize / singularize', () => {
    it('handles regular plurals', () => {
      expect(pluralize('task')).toBe('tasks')
      expect(singularize('tasks')).toBe('task')
    })
    it('handles -y -> -ies', () => {
      expect(pluralize('category')).toBe('categories')
      expect(singularize('categories')).toBe('category')
    })
    it('handles sibilant endings', () => {
      expect(pluralize('box')).toBe('boxes')
      expect(pluralize('class')).toBe('classes')
    })
    it('handles irregulars', () => {
      expect(pluralize('person')).toBe('people')
      expect(singularize('people')).toBe('person')
    })
  })

  describe('detectAuthRequirement', () => {
    it('detects explicit auth language', () => {
      expect(detectAuthRequirement('an app with login and signup')).toBe(true)
      expect(detectAuthRequirement('users need to register with a password')).toBe(true)
    })
    it('detects personalization cues', () => {
      expect(detectAuthRequirement('a place to store my notes')).toBe(true)
      expect(detectAuthRequirement("show each user's tasks")).toBe(true)
    })
    it('returns false for anonymous apps', () => {
      expect(detectAuthRequirement('a public product catalog')).toBe(false)
    })
  })

  describe('detectVectorRequirement', () => {
    it('detects semantic/vector search language', () => {
      expect(detectVectorRequirement('add semantic search over docs')).toBe(true)
      expect(detectVectorRequirement('a RAG chatbot')).toBe(true)
    })
    it('returns false otherwise', () => {
      expect(detectVectorRequirement('a simple todo list')).toBe(false)
    })
  })
})

describe('schema-inference: extractEntities', () => {
  it('picks up known entities in singular or plural form', () => {
    expect(extractEntities('a todo app to manage tasks')).toContain('task')
    expect(extractEntities('build a blog with posts')).toContain('post')
  })

  it('extracts multiple distinct entities', () => {
    const entities = extractEntities('store customers and their orders and products')
    expect(entities).toEqual(expect.arrayContaining(['customer', 'order', 'product']))
  })

  it('de-duplicates repeated mentions', () => {
    const entities = extractEntities('tasks tasks and more tasks')
    expect(entities.filter((e) => e === 'task')).toHaveLength(1)
  })

  it('filters noise words like app / dashboard / page', () => {
    const entities = extractEntities('a dashboard app page interface')
    expect(entities).not.toContain('dashboard')
    expect(entities).not.toContain('app')
    expect(entities).not.toContain('page')
  })

  it('falls back to generic plural nouns not in the library', () => {
    const entities = extractEntities('track widgets in a warehouse')
    expect(entities).toContain('widget')
  })
})

describe('schema-inference: inferSchema', () => {
  it('builds a table with system columns for a simple prompt', () => {
    const schema = inferSchema('a todo app to manage tasks')
    const tasks = schema.tables.find((t) => t.name === 'tasks')
    expect(tasks).toBeDefined()
    const colNames = tasks!.columns.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('created_at')
    expect(colNames).toContain('updated_at')
    expect(colNames).toContain('title')
  })

  it('adds a users table and user_id scoping when auth is required', () => {
    const schema = inferSchema('an app where users log in and manage their own tasks')
    expect(schema.requiresAuth).toBe(true)
    expect(schema.tables.some((t) => t.name === 'users')).toBe(true)
    const tasks = schema.tables.find((t) => t.name === 'tasks')!
    expect(tasks.userScoped).toBe(true)
    const userId = tasks.columns.find((c) => c.name === 'user_id')
    expect(userId).toBeDefined()
    expect(userId!.references).toEqual({ table: 'users', column: 'id' })
  })

  it('never double-scopes the users table itself', () => {
    const schema = inferSchema('users login system', { requireAuth: true })
    const users = schema.tables.find((t) => t.name === 'users')!
    expect(users.userScoped).toBe(false)
    expect(users.columns.some((c) => c.name === 'user_id')).toBe(false)
  })

  it('honors an explicit requireAuth override', () => {
    const schema = inferSchema('a public product catalog', { requireAuth: true })
    expect(schema.requiresAuth).toBe(true)
    expect(schema.tables.some((t) => t.name === 'users')).toBe(true)
  })

  it('detects vector search requirement', () => {
    const schema = inferSchema('notes app with semantic search')
    expect(schema.requiresVectorSearch).toBe(true)
    expect(schema.notes.join(' ')).toMatch(/semantic search/i)
  })

  it('falls back to a generic items table when no entities are found', () => {
    const schema = inferSchema('make me something cool')
    expect(schema.tables).toHaveLength(1)
    expect(schema.tables[0].name).toBe('items')
  })

  it('respects the maxTables cap', () => {
    const schema = inferSchema(
      'customers orders products invoices bookings events comments messages projects',
      { maxTables: 3 }
    )
    expect(schema.tables.length).toBeLessThanOrEqual(3)
    expect(schema.notes.join(' ')).toMatch(/capped/i)
  })

  it('marks unique columns from the entity library', () => {
    const schema = inferSchema('a customer directory')
    const customers = schema.tables.find((t) => t.name === 'customers')!
    const email = customers.columns.find((c) => c.name === 'email')!
    expect(email.unique).toBe(true)
  })

  it('is deterministic for the same prompt', () => {
    const a = inferSchema('manage tasks and projects with login')
    const b = inferSchema('manage tasks and projects with login')
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })
})

describe('schema-inference: describeSchema', () => {
  it('summarizes tables, auth, and vector search', () => {
    const schema = inferSchema('tasks with login and semantic search')
    const text = describeSchema(schema)
    expect(text).toMatch(/table/i)
    expect(text).toMatch(/authentication/i)
    expect(text).toMatch(/vector search/i)
    expect(text).toMatch(/tasks/)
  })
})
