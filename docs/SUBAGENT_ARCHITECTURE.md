# Subagent Architecture

> **Hierarchical Multi-Agent System for AI-Powered Component Generation**

This document describes the 4-tier hierarchical agent system used in AINative Component Builder for generating production-ready React components through coordinated AI collaboration.

## Table of Contents

- [Overview](#overview)
- [Agent Profiles](#agent-profiles)
- [Workflow](#workflow)
- [Configuration](#configuration)
- [Agent-Specific Settings](#agent-specific-settings)
- [Implementation Details](#implementation-details)
- [Examples](#examples)

---

## Overview

The subagent architecture implements a **hierarchical multi-agent system** inspired by enterprise software development teams. Instead of a single monolithic AI generating components, we use specialized agents that collaborate under the coordination of an orchestrator.

### The 4-Tier System

```
┌─────────────────────────────────────────────────────────────┐
│                    1. ORCHESTRATOR                          │
│                  (Cody - Team Leader)                       │
│  Coordinates workflow, makes decisions, ensures quality     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ├─────────────────┬──────────────┐
                              ▼                 ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│         2. DESIGN SUBAGENT                                  │
│   (ai-product-architect + system-architect)                 │
│   Requirements analysis, design specifications              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│         3. CODE SUBAGENT                                    │
│   (frontend-ui-builder + ai-product-architect)              │
│   Component implementation, code generation                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│         4. VALIDATION SUBAGENT                              │
│   (qa-bug-hunter + test-engineer)                           │
│   Quality checks, validation, testing                       │
└─────────────────────────────────────────────────────────────┘
```

### Why Hierarchical Agents?

**Traditional Approach (Single Agent):**
- One AI tries to do everything: requirements, design, code, validation
- Quality varies based on prompt complexity
- Difficult to enforce specific standards
- Hard to debug when things go wrong

**Hierarchical Approach (Multi-Agent):**
- Each agent is specialized and optimized for its role
- Clear separation of concerns
- Better quality control at each stage
- Easier to iterate and improve specific capabilities
- Mimics real software development teams

---

## Agent Profiles

The system leverages **Claude Code Agent Profiles** from `~/.claude/agents` to give each subagent specialized expertise. These profiles contain detailed instructions, best practices, and domain knowledge that shape how each agent operates.

### Profile Mapping

The subagent system maps specific Claude Code agent profiles to each role:

```typescript
export const SUBAGENT_PROFILE_MAPPING = {
  orchestrator: ['cody-team-leader'],
  design: ['ai-product-architect', 'system-architect'],
  code: ['frontend-ui-builder', 'ai-product-architect'],
  validation: ['qa-bug-hunter', 'test-engineer'],
}
```

### 1. Orchestrator Agent - "Cody"

**Profile:** `cody-team-leader`

**Role:** Strategic leader and coordinator with 30 years of experience

**Responsibilities:**
- Coordinates the entire component generation workflow
- Makes architectural and strategic decisions
- Delegates tasks to specialized subagents
- Ensures all work meets enterprise quality standards
- Provides final approval before shipping

**Key Characteristics:**
- Pragmatic architecture (build what you need today, design for tomorrow)
- Quality at speed (fast delivery + high quality)
- Data-driven decisions
- Clear communication
- Bias for action

**Communication Style:**
```
👔 CODY: Alright team, we have a new component to build. Let's do this right.
```

### 2. Design Subagent

**Profiles:** `ai-product-architect` + `system-architect`

**Role:** Requirements analysis and design specification

**Responsibilities:**
- Analyze user requirements and extract intent
- Create detailed design specifications
- Define component structure and layout
- Specify color schemes (solid colors only)
- Plan data requirements and mock data
- Define interaction patterns
- Ensure accessibility considerations

**Critical Design Rules:**
- ❌ NO gradients (no `bg-gradient-*`, `from-*`, `to-*` classes)
- ❌ NO emoticons (no emoji like 🏠, 📊, ✅)
- ✅ Use SOLID colors only (`bg-blue-500`, `bg-gray-100`)
- ✅ Use icon libraries only (lucide-react, react-icons, heroicons)
- ✅ Plan for responsive design (mobile-first)
- ✅ Include accessibility considerations

**Output:** Comprehensive design specification document

### 3. Code Subagent

**Profiles:** `frontend-ui-builder` + `ai-product-architect`

**Role:** Component implementation and code generation

**Responsibilities:**
- Generate React component code from design specs
- Implement responsive layouts with Tailwind CSS
- Use icon libraries (lucide-react, heroicons, react-icons)
- Define all data variables and mock data
- Ensure components are self-contained
- Implement proper event handlers
- Follow clean code principles

**Critical Code Generation Rules:**
1. ❌ NEVER use Tailwind gradient classes
2. ❌ NEVER use emoticons/emoji in code
3. ✅ ONLY use solid Tailwind colors
4. ✅ ONLY use icon libraries for icons
5. ✅ Define ALL data variables before use
6. ✅ Make components fully self-contained
7. ✅ Ensure all interactive elements have proper event handlers

**Tool Integration:**
Uses the **Component Generation Tool** (Tool Use API) for structured output:

```typescript
{
  name: 'generate_react_component',
  description: 'Generate a complete, self-contained React component',
  input_schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Complete React component code' },
      explanation: { type: 'string', description: 'Brief explanation' },
      // ...
    }
  }
}
```

**Output:** Production-ready React component code

### 4. Validation Subagent

**Profiles:** `qa-bug-hunter` + `test-engineer`

**Role:** Quality assurance and validation

**Responsibilities:**
- Validate generated code against design specifications
- Check for gradients and emoticons (critical violations)
- Verify all variables are defined
- Ensure all design features are implemented
- Validate color scheme compliance
- Check icon library usage
- Verify event handlers on interactive elements
- Assess production readiness

**Quality Checks:**
1. ❌ Gradients - Check for Tailwind gradient classes
2. ❌ Emoticons - Check for emoji/emoticons
3. ❌ Undefined Variables - Ensure all variables are defined
4. ❌ Missing Features - Verify all design spec features
5. ❌ Color Scheme - Confirm only solid colors
6. ✅ Icon Libraries - Verify proper usage
7. ✅ Event Handlers - All interactive elements covered
8. ✅ Component Structure - Proper React patterns
9. ✅ Accessibility - ARIA labels, keyboard navigation
10. ✅ Data Structure - Mock data properly structured

**Output:** Validation report with PASS/FAIL status and detailed findings

---

## Workflow

The orchestrator coordinates a **3-step sequential workflow** where each subagent builds on the previous agent's output.

### Detailed Workflow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     USER REQUEST                            │
│     "Create a dashboard with charts and tables"             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR (Cody)                       │
│  👔 "Alright team, we have a new component to build.        │
│     Let's do this right."                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               STEP 1: DESIGN ANALYSIS                       │
│  👔 CODY: "Design team, analyze the requirements and        │
│            give me a solid spec."                           │
│  🎨 Design Agents: "On it, Cody..."                         │
│                                                             │
│  Input:  User request + memory context                     │
│  Output: Design specification document                     │
│                                                             │
│  ✅ Design team: "Spec is ready, Cody."                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              STEP 2: CODE GENERATION                        │
│  👔 CODY: "Good work. Dev team, take this spec and          │
│            build it clean."                                 │
│  💻 Code Agents: "Building component..."                    │
│                                                             │
│  Input:  Design spec + system prompt + user request        │
│  Output: React component code                              │
│  Tool:   generate_react_component (Tool Use API)           │
│                                                             │
│  ✅ Dev team: "Component built, Cody."                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              STEP 3: QUALITY VALIDATION                     │
│  👔 CODY: "Nice. QA team, tear it apart. I want to          │
│            know every issue before this ships."             │
│  🔍 QA Agents: "Running comprehensive quality checks..."    │
│                                                             │
│  Input:  Component code + design spec                      │
│  Output: Validation report (PASS/FAIL)                     │
│                                                             │
│  ✅ QA team: "All checks passed, Cody. Production-ready."  │
│  👔 CODY: "Excellent work, team. Ship it with confidence."  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  FINAL COMPONENT                            │
│              (Ready for Preview)                            │
└─────────────────────────────────────────────────────────────┘
```

### Error Handling

Each step includes failure handling:

```typescript
// Step 1: Design failure
if (!designResult.success) {
  console.error('👔 CODY: Design analysis failed. We need to regroup.')
  return { success: false, validationReport: 'Design analysis failed' }
}

// Step 2: Code failure
if (!codeResult.success) {
  console.error('👔 CODY: Code generation failed. Not acceptable.')
  return { success: false, validationReport: 'Code generation failed' }
}

// Step 3: Validation failure
if (!validationResult.success) {
  console.warn('👔 CODY: Issues found. We ship with quality or we don\'t ship.')
}
```

---

## Configuration

The subagent system is controlled by the `USE_SUBAGENTS` environment variable.

### Environment Variable

```bash
# .env
USE_SUBAGENTS=true  # Enable hierarchical multi-agent system
```

### How It Works

In the chat API route (`app/api/chat-ws/route.ts`):

```typescript
// Check if subagents mode is enabled
const useSubagents = process.env.USE_SUBAGENTS === 'true'

if (useSubagents) {
  // Use Subagents orchestrator for complex multi-step generation
  const orchestratorResult = await runOrchestratorAgent(
    enhancedPrompt,
    enhancedSystemPrompt,
    memoryContext
  )

  if (orchestratorResult.success) {
    fullContent = orchestratorResult.componentCode
    updatePreviewPartial(responseId, fullContent)
  } else {
    throw new Error('Subagent orchestration failed')
  }
} else {
  // Use standard streaming with Tool Use API
  // (Single-agent approach with extended thinking)
  const stream = await anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    // ...
  })
}
```

### Modes Comparison

| Feature | Standard Mode<br/>(`USE_SUBAGENTS=false`) | Subagent Mode<br/>(`USE_SUBAGENTS=true`) |
|---------|-------------------------------------------|------------------------------------------|
| **Agents** | Single agent with extended thinking | 4-tier hierarchical system |
| **Streaming** | Real-time streaming to client | Batch processing (preview updates) |
| **Quality Control** | Single-pass with auto-retry | Multi-stage validation |
| **Specialization** | General-purpose component generation | Specialized agents for each stage |
| **Debugging** | Single point of failure | Clear stage-by-stage visibility |
| **Cost** | Lower API calls | Higher API calls (3 subagents) |
| **Quality** | Good for simple components | Better for complex components |

### When to Use Each Mode

**Standard Mode (Default):**
- Simple component requests
- Fast iteration needed
- Cost optimization priority
- Real-time streaming experience desired

**Subagent Mode:**
- Complex component requirements
- Production-critical components
- Need for detailed design specs
- Quality over speed priority
- Multi-feature components

---

## Agent-Specific Settings

Each subagent has specific configuration parameters optimized for its role.

### Design Subagent Settings

```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4000,        // Sufficient for detailed specs
  temperature: 1,          // Required for extended thinking
  thinking: {
    type: 'enabled',
    budget_tokens: 2000,   // Cody's thinking power for analysis
  },
  // No tools - pure text analysis
})
```

**Rationale:**
- **max_tokens: 4000** - Design specs need comprehensive detail
- **thinking budget: 2000** - Deep analysis requires extended thinking
- **No tools** - Design is text-based reasoning, not structured output

### Code Subagent Settings

```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 8000,        // Largest - complex component code
  temperature: 1,
  thinking: {
    type: 'enabled',
    budget_tokens: 2000,   // Think before coding
  },
  tools: [COMPONENT_GENERATION_TOOL],  // Structured output
})
```

**Rationale:**
- **max_tokens: 8000** - Component code can be lengthy
- **thinking budget: 2000** - Plan implementation before writing code
- **Tools: Component Generation Tool** - Enforces structured output format

### Validation Subagent Settings

```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1500,        // Smallest - concise reports
  temperature: 0.3,        // Lower = more deterministic checks
  // No thinking - pure evaluation task
})
```

**Rationale:**
- **max_tokens: 1500** - Validation reports should be concise
- **temperature: 0.3** - Deterministic quality checks
- **No thinking** - Validation is checklist-based, not creative

### Model Configuration

All subagents use the same model for consistency:

```bash
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

**Why Claude Sonnet 4:**
- Extended thinking capability (2000 token budget)
- High-quality code generation
- Tool Use API support
- Strong reasoning for validation tasks
- Excellent at following complex instructions

---

## Implementation Details

### File Structure

```
lib/
├── agent/
│   ├── subagents.ts              # Main orchestrator + subagent logic
│   ├── agent-profiles.ts         # Profile loading and management
│   └── component-generation-tool.ts  # Tool Use API definition
```

### Agent Profile Loading

```typescript
// Load all agent profiles from ~/.claude/agents on startup
const agentProfiles = loadAgentProfiles()

// Get specific profiles for a subagent
function buildSystemPromptFromProfiles(
  profileNames: string[],
  taskContext: string
): string {
  const profiles = getAgentProfiles(profileNames)

  let systemPrompt = `You are a specialized agent combining expertise:\n\n`

  profiles.forEach((profile, index) => {
    systemPrompt += `## Agent Profile ${index + 1}: ${profile.name}\n\n`
    systemPrompt += `${profile.instructions}\n\n---\n\n`
  })

  systemPrompt += `## Current Task Context\n\n${taskContext}`
  return systemPrompt
}
```

### Orchestrator Function

The orchestrator coordinates all subagents:

```typescript
export async function runOrchestratorAgent(
  userPrompt: string,
  systemPrompt: string,
  memoryContext: string
): Promise<{
  designSpec: string
  componentCode: string
  validationReport: string
  success: boolean
}>
```

### Subagent Functions

Each subagent has a dedicated function:

```typescript
// Design Subagent
export async function runDesignSubagent(
  userPrompt: string,
  memoryContext: string
): Promise<SubagentResult>

// Code Subagent
export async function runCodeSubagent(
  designSpec: string,
  systemPrompt: string,
  userPrompt: string
): Promise<SubagentResult>

// Validation Subagent
export async function runValidationSubagent(
  componentCode: string,
  designSpec: string
): Promise<SubagentResult>
```

---

## Examples

### Example 1: Simple Dashboard Request

**User Request:**
```
Create a dashboard with user stats and activity chart
```

**Design Subagent Output (excerpt):**
```markdown
1. Component Type: Dashboard Interface
2. Layout Structure:
   - Header with title and user info
   - Stats grid (3 columns)
   - Activity chart section
3. Color Scheme:
   - Background: bg-gray-50
   - Cards: bg-white
   - Primary: bg-blue-500
   - Text: text-gray-800
4. Key Features:
   - User statistics cards (Total Users, Active, New)
   - Line chart for activity trends
   - Responsive grid layout
5. Data Requirements:
   const stats = [
     { label: 'Total Users', value: '2,543' },
     { label: 'Active Now', value: '127' },
     { label: 'New Today', value: '18' }
   ]
   const chartData = [/* activity data */]
```

**Code Subagent Output (excerpt):**
```jsx
import { Users, Activity, TrendingUp } from 'lucide-react'

export default function Dashboard() {
  const stats = [
    { label: 'Total Users', value: '2,543', icon: Users },
    { label: 'Active Now', value: '127', icon: Activity },
    { label: 'New Today', value: '18', icon: TrendingUp }
  ]

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">
          Dashboard
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {stats.map((stat, index) => {
            const Icon = stat.icon
            return (
              <div key={index} className="bg-white p-6 rounded-lg shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-600 text-sm">{stat.label}</p>
                    <p className="text-3xl font-bold text-gray-800">
                      {stat.value}
                    </p>
                  </div>
                  <Icon className="w-8 h-8 text-blue-500" />
                </div>
              </div>
            )
          })}
        </div>
        {/* Chart section... */}
      </div>
    </div>
  )
}
```

**Validation Subagent Output:**
```markdown
**Status**: PASS

**Issues Found**: None

**Quality Checks:**
✅ No gradients detected
✅ No emoticons (uses lucide-react icons)
✅ All variables defined (stats, chartData)
✅ All design features implemented
✅ Solid colors only (bg-gray-50, bg-white, bg-blue-500)
✅ Icon libraries used correctly
✅ Interactive elements have proper structure
✅ Component properly structured
✅ Responsive design (grid with breakpoints)

**Production Readiness**: Component is production-ready and meets all quality standards.
```

### Example 2: Conversation Logs

When subagents are enabled, you'll see orchestration logs:

```
👔 CODY (Team Leader): Alright team, we have a new component to build. Let's do this right.

📋 Mission: "Create a dashboard with user stats and activity chart"

👔 CODY: Design team, analyze the requirements and give me a solid spec.
🎨 [1/3] Design Agents (ai-product-architect + system-architect): On it, Cody...

✅ Design team: Spec is ready, Cody.
👔 CODY: Good work. Dev team, take this spec and build it clean.

💻 [2/3] Code Agents (frontend-ui-builder + ai-product-architect): Building component...

✅ Dev team: Component built, Cody.
👔 CODY: Nice. QA team, tear it apart. I want to know every issue before this ships.

🔍 [3/3] QA Agents (qa-bug-hunter + test-engineer): Running comprehensive quality checks...

✅ QA team: All checks passed, Cody. This is production-ready.
👔 CODY: Excellent work, team. Ship it with confidence. 🚀
```

---

## Benefits of the Subagent Architecture

### 1. Improved Quality
- Each agent specializes in its domain
- Multi-stage validation catches more issues
- Clear quality gates at each step

### 2. Better Debugging
- Stage-by-stage visibility into the process
- Clear failure points (design, code, or validation)
- Detailed logs from each agent

### 3. Maintainability
- Easier to improve specific capabilities
- Agent profiles can be updated independently
- Clear separation of concerns

### 4. Scalability
- Can add new subagent types (e.g., accessibility, performance)
- Can parallelize independent stages in the future
- Profiles can be customized per project

### 5. Transparency
- Users see which agent is working at each stage
- Clear progress indicators
- Understandable workflow

---

## Future Enhancements

### Planned Improvements

1. **Parallel Execution**
   - Run independent validations in parallel
   - Faster overall generation time

2. **Specialized Validators**
   - Accessibility validator subagent
   - Performance validator subagent
   - Security validator subagent

3. **Learning System**
   - Track validation failures
   - Improve agent prompts based on patterns
   - Build knowledge base of common issues

4. **Custom Agent Profiles**
   - Per-project agent customization
   - Industry-specific profiles (e-commerce, fintech, healthcare)
   - Team-specific coding standards

5. **Agent Collaboration**
   - Agents can request clarification from each other
   - Iterative refinement between design and code
   - Automated fix loops for validation failures

---

## Troubleshooting

### Common Issues

**Issue:** Subagents not activating
```bash
# Check environment variable
echo $USE_SUBAGENTS  # Should output: true

# Verify .env file
grep USE_SUBAGENTS .env
```

**Issue:** Agent profiles not loading
```bash
# Check agent profiles directory
ls -la ~/.claude/agents/*.md

# Look for loading message in logs
# Should see: "✅ Loaded X agent profiles from ~/.claude/agents"
```

**Issue:** Missing agent profiles
```bash
# Required profiles for subagents:
# - cody-team-leader.md
# - ai-product-architect.md
# - system-architect.md
# - frontend-ui-builder.md
# - qa-bug-hunter.md
# - test-engineer.md

# Verify all are present:
ls ~/.claude/agents/{cody-team-leader,ai-product-architect,system-architect,frontend-ui-builder,qa-bug-hunter,test-engineer}.md
```

### Debug Logging

Enable detailed logging:
```typescript
console.log('🤖 Available agent profiles:', Array.from(agentProfiles.keys()))
```

Check orchestrator output:
```typescript
const orchestratorResult = await runOrchestratorAgent(...)
console.log('Design Spec:', orchestratorResult.designSpec)
console.log('Component Code:', orchestratorResult.componentCode)
console.log('Validation Report:', orchestratorResult.validationReport)
console.log('Success:', orchestratorResult.success)
```

---

## References

- **Implementation:** `lib/agent/subagents.ts`
- **Profile Loading:** `lib/agent/agent-profiles.ts`
- **Tool Definition:** `lib/agent/component-generation-tool.ts`
- **API Route:** `app/api/chat-ws/route.ts`
- **Agent Profiles:** `~/.claude/agents/*.md`

---

## Summary

The subagent architecture represents a paradigm shift from monolithic AI component generation to a collaborative, specialized multi-agent system. By mimicking real software development teams with specialized roles (design, code, QA) coordinated by an experienced leader (Cody), we achieve:

- **Higher quality** through specialized expertise
- **Better reliability** through multi-stage validation
- **Greater transparency** through clear workflow stages
- **Easier maintenance** through modular agent design
- **Scalable growth** through independent agent improvement

The system is production-ready, configurable via environment variables, and designed to evolve as agent capabilities improve.

---

**Last Updated:** 2026-03-02
**Version:** 1.0
**Status:** Production Ready
