#!/usr/bin/env tsx
import { validateGeneratedCode } from '../lib/code-validator'

// Test the Dashboard pattern with semicolon after bracket
const code = `\`\`\`jsx
function Dashboard() {
  const data = [{;
    name: "Test",
    value: 100
  }];
  return <div>Dashboard</div>;
}
\`\`\``

console.log('Testing Dashboard pattern with semicolon after bracket...\n')
const result = validateGeneratedCode(code)
console.log('Valid:', result.valid)
console.log('Error:', result.error)
console.log('Fixes:', result.fixes)
console.log('\nFixed code:')
console.log(result.code)
