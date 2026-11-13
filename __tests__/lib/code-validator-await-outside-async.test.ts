import { describe, it, expect } from 'vitest'
import { findAwaitOutsideAsyncFunction, validateJavaScriptCode } from '@/lib/code-validator'

/**
 * #1963: validateJavaScriptCode's two parse() calls set
 * allowAwaitOutsideFunction: true to permit legitimate module-top-level
 * await — but that option disables Babel's "await only valid in async
 * function" check for the ENTIRE file, not just the top level, so neither
 * parse call (nor findUndefinedReferences' own AST walk, same flags) can
 * ever catch await used inside a nested non-async callback. This is a
 * real SyntaxError in Sandpack's strict bundler.
 */
describe('code-validator — await outside an async function is detected (#1963)', () => {
  it('flags await inside a non-async .map() callback, even though the outer function is async', () => {
    const code = [
      'async function toggleTaskCompletion(taskId) {',
      '  const updatedTasks = tasks.map(task => {',
      '    if (task.id === taskId) {',
      "      const res = await fetch(`/api/db/tasks?id=${taskId}`)",
      '      return res.json()',
      '    }',
      '    return task',
      '  })',
      '  updateTasks(updatedTasks)',
      '}',
    ].join('\n')
    expect(findAwaitOutsideAsyncFunction(code)).toBe(true)
  })

  it('does NOT flag await inside a genuinely async callback', () => {
    const code = [
      'async function toggleTaskCompletion(taskId) {',
      '  const updatedTasks = await Promise.all(tasks.map(async task => {',
      '    if (task.id === taskId) {',
      "      const res = await fetch(`/api/db/tasks?id=${taskId}`)",
      '      return res.json()',
      '    }',
      '    return task',
      '  }))',
      '  updateTasks(updatedTasks)',
      '}',
    ].join('\n')
    expect(findAwaitOutsideAsyncFunction(code)).toBe(false)
  })

  it('does NOT flag a true module-top-level await (the option\'s original intent)', () => {
    const code = "const data = await fetch('/api/data')\nexport default data"
    expect(findAwaitOutsideAsyncFunction(code)).toBe(false)
  })

  it('does NOT flag await inside an async arrow function assigned to a variable', () => {
    const code = [
      'const load = async () => {',
      "  const res = await fetch('/api/data')",
      '  return res.json()',
      '}',
    ].join('\n')
    expect(findAwaitOutsideAsyncFunction(code)).toBe(false)
  })

  it('flags await inside a non-async arrow function nested in an async function', () => {
    const code = [
      'async function outer() {',
      '  const helper = () => {',
      "    const x = await fetch('/api/data')",
      '    return x',
      '  }',
      '  return helper()',
      '}',
    ].join('\n')
    expect(findAwaitOutsideAsyncFunction(code)).toBe(true)
  })

  it('validateJavaScriptCode rejects code with await in a non-async nested callback', () => {
    const code = [
      'async function toggleTaskCompletion(taskId, tasks) {',
      '  const updatedTasks = tasks.map(task => {',
      "    const res = await fetch(`/api/db/tasks?id=${taskId}`)",
      '    return res',
      '  })',
      '  return updatedTasks',
      '}',
      'export default function App() { return (<div>hi</div>) }',
    ].join('\n')
    const result = validateJavaScriptCode(code)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/await/i)
  })
})
