import { describe, it, expect } from 'vitest'
import { findAwaitInNonAsyncFunction, validateJavaScriptCode } from '@/lib/code-validator'

/**
 * #1963 real bug, found live in company `younova-hN2q6y`'s
 * src/components/TaskList.tsx: an `async` outer handler calls `.map()` with a
 * plain, non-async callback, then uses `await` inside THAT callback — a
 * RUNTIME-FATAL SyntaxError ("Unexpected reserved word 'await'") that
 * Sandpack's strict parser throws on but validateJavaScriptCode's two parse
 * calls never saw, because both set `allowAwaitOutsideFunction: true`.
 */
describe('code-validator — findAwaitInNonAsyncFunction (#1963)', () => {
  it('flags await inside a non-async callback passed to .map()', () => {
    const code = [
      "import React from 'react'",
      'function TaskList({ tasks, updateTasks }) {',
      '  const toggleTaskCompletion = async (taskId) => {',
      '    const updatedTasks = tasks.map(task => {',
      '      if (task.id === taskId) {',
      "        const res = await fetch(`/api/db/tasks?id=${taskId}`, { method: 'PUT' })",
      '        return res.json()',
      '      }',
      '      return task',
      '    })',
      '    updateTasks(updatedTasks)',
      '  }',
      '  return null',
      '}',
      'export default TaskList',
    ].join('\n')
    const result = findAwaitInNonAsyncFunction(code)
    expect(result).not.toBeNull()
    expect(result).toMatch(/await.*not declared 'async'/)
  })

  it('does not flag await inside an async callback passed to .map()', () => {
    const code = [
      "import React from 'react'",
      'function TaskList({ tasks }) {',
      '  const load = async () => {',
      '    const updated = await Promise.all(tasks.map(async task => {',
      "      const res = await fetch(`/api/db/tasks?id=${task.id}`)",
      '      return res.json()',
      '    }))',
      '    return updated',
      '  }',
      '  return null',
      '}',
      'export default TaskList',
    ].join('\n')
    expect(findAwaitInNonAsyncFunction(code)).toBeNull()
  })

  it('does not flag a true module-top-level await (the intended allowAwaitOutsideFunction case)', () => {
    const code = ["const data = await fetch('/api/db/config')", 'export default data'].join('\n')
    expect(findAwaitInNonAsyncFunction(code)).toBeNull()
  })

  it('does not false-flag a non-async function that never uses await', () => {
    const code = [
      "import React from 'react'",
      'function App({ tasks }) {',
      '  const names = tasks.map(task => task.name)',
      '  return null',
      '}',
      'export default App',
    ].join('\n')
    expect(findAwaitInNonAsyncFunction(code)).toBeNull()
  })

  it('flags await inside a non-async nested FunctionExpression (not just arrows)', () => {
    const code = [
      'async function outer(tasks) {',
      '  return tasks.map(function (task) {',
      '    return await Promise.resolve(task)',
      '  })',
      '}',
      'export default outer',
    ].join('\n')
    const result = findAwaitInNonAsyncFunction(code)
    expect(result).not.toBeNull()
  })

  it('validateJavaScriptCode rejects code with this bug as invalid, with a SyntaxError message', () => {
    const code = [
      "import React from 'react'",
      'export default function App({ tasks, updateTasks }) {',
      '  const toggle = async (id) => {',
      '    const updated = tasks.map(t => {',
      '      if (t.id === id) return fetchWrapper(t)',
      '      return t',
      '    })',
      '    updateTasks(updated)',
      '  }',
      '  function fetchWrapper(t) {',
      "    return await fetch('/api/db/tasks')",
      '  }',
      '  return null',
      '}',
    ].join('\n')
    const result = validateJavaScriptCode(code)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SyntaxError')
  })
})
