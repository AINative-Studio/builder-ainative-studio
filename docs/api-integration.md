# Chunking System API Integration

## Overview

The chunking system is now fully integrated into the chat-ws API endpoint (`/app/api/chat-ws/route.ts`). This document explains how the system works and how to use it.

## How It Works

### 1. Automatic Complexity Detection

When a user sends a PRD, the system automatically:

1. Parses the PRD to extract pages, components, and features
2. Analyzes complexity using multiple metrics:
   - Page count (× 1,500 tokens per page)
   - Feature count (× 800 tokens per feature)
   - Component count (× 400 tokens per component)
   - State complexity multiplier (1.0-1.5x based on Zustand, forms, etc.)
3. Estimates total tokens required
4. Determines if chunking is needed (>10,000 tokens OR >5 pages)

### 2. Intelligent Routing

```typescript
if (complexityScore.requiresChunking && previousMessages.length === 0) {
  // Use multi-pass chunking strategy
} else {
  // Use single-pass generation
}
```

**Important**: Chunking is ONLY used for:
- Complex applications (6+ pages or 10k+ estimated tokens)
- New chats (not continuations - `previousMessages.length === 0`)

For simple applications or follow-up messages, the system uses the existing single-pass generation.

### 3. Multi-Phase Generation Flow

When chunking is triggered:

#### Phase 1: Core Structure (6-8k tokens)
- Root layout and navigation
- Global state management (Zustand)
- TypeScript type definitions
- Mock data generators
- Routing structure with placeholder pages
- Shared component library (Button, Card, Modal, etc.)

**Key**: Pages are created as PLACEHOLDERS - no feature implementation yet

#### Phase 2: Feature Chunks (4-6k tokens each)
- Pages grouped by route prefix (e.g., `/products/*`)
- Max 3 pages per chunk for optimal token usage
- Full implementation of assigned pages only
- Uses existing types and mock data from Phase 1

**Example for Bay View (7 pages)**:
- Chunk 2.1: Homepage + Article page
- Chunk 2.2: Podcast + Archive pages
- Chunk 2.3: Chat + Subscription + Insights pages

#### Phase 3: Integration (2-3k tokens)
- Cross-module navigation and linking
- Shared state connections
- Global error handling
- Loading states and skeletons
- Final polish (responsive, a11y, etc.)

### 4. Code Merging

After all phases complete, the system merges chunks:

1. Start with Phase 1 (core structure)
2. Merge Phase 2 chunks (append feature implementations)
3. Apply Phase 3 (integration layer)
4. Deduplicate imports
5. Clean up markers and excessive blank lines
6. Validate merged output

### 5. Progress Streaming

The system streams progress events to the client via SSE:

```typescript
{
  type: 'chunk_progress',
  phase: 2,
  totalPhases: 4,
  message: 'Generating Products module...',
  chunkId: 'phase-2-1-products',
  targetTokens: 5000
}
```

This allows the UI to show real-time progress during multi-phase generation.

## API Endpoint Changes

### New Imports

```typescript
import { analyzeComplexity, getComplexityReport } from '@/lib/agent/complexity-analyzer'
import { createChunkPlan, getChunkPlanSummary } from '@/lib/agent/chunk-planner'
import { executeChunkPlan, getGenerationSummary } from '@/lib/agent/multi-pass-generator'
import { mergeChunks, getMergeSummary } from '@/lib/agent/chunk-merger'
```

### Complexity Analysis (After PRD Parsing)

```typescript
const complexityScore = analyzeComplexity(prdAnalysis, message)
console.log('\n' + getComplexityReport(complexityScore))
```

**Output Example**:
```
📊 Complexity Analysis:
   Pages: 7
   Features: 12
   Components: 15
   State Complexity: complex
   Overall: complex
   Estimated Tokens: 18,500

⚠️  Application exceeds single-pass token limit
   Strategy: 3-phase
   Will generate in multiple phases
```

### Chunking Branch

```typescript
if (complexityScore.requiresChunking && previousMessages.length === 0) {
  // Create chunk plan
  const chunkPlan = createChunkPlan(message, prdAnalysis, complexityScore)

  // Execute with progress callbacks
  const chunks = await executeChunkPlan(chunkPlan, anthropic, progressCallback)

  // Merge chunks
  fullContent = mergeChunks(chunks)

  // Calculate token usage
  tokenUsage = { ... }
}
```

### Single-Pass Branch (Unchanged)

Existing single-pass generation code remains unchanged for:
- Simple applications (1-5 pages, <10k tokens)
- Chat continuations (follow-up messages)

## Console Logging

The system provides detailed console logs for debugging:

### Complexity Report
```
📊 Complexity Analysis:
   Pages: 7
   Features: 12
   State Complexity: medium
   Estimated Tokens: 15,200
   Strategy: 3-phase
```

### Chunk Plan
```
📋 Generation Plan: 4 phases
⏱️  Estimated time: 10 minutes
🎯 Estimated tokens: 16,500

🏗️ Phase 1: Core application structure, routing, types, and mock data
   Target: 7,000 tokens

✨ Phase 2.1: Homepage and Article pages
   Target: 5,000 tokens
   Pages: /home, /article/:slug

✨ Phase 2.2: Podcast and Archive pages
   Target: 5,000 tokens
   Pages: /podcast/:id, /archive

🔗 Phase 3: Cross-module integration and final polish
   Target: 2,500 tokens
```

### Generation Progress
```
   [Phase 1/4] Starting multi-phase generation...
   [Phase 1/4] Generating Core application structure...
   [Phase 1/4] Calling Claude API for phase 1...
   [Phase 1/4] Extracting and validating code...
   [Phase 1/4] Phase 1 completed successfully
```

### Generation Summary
```
📊 Generation Summary:
   Total Phases: 4
   Successful: 4
   Failed: 0
   Total Tokens: 19,234
   Total Time: 124.3s

✅ Phase 1: 7,123 tokens in 31.2s
✅ Phase 2.1: 5,234 tokens in 28.4s
✅ Phase 2.2: 4,987 tokens in 27.1s
✅ Phase 3: 2,890 tokens in 37.6s
```

### Merge Summary
```
🔀 Merge Summary:
   Chunks Merged: 4/4
   Total Lines: 1,247
   Components: 23
   Imports: 45
   Validation: ✅ Passed
```

### Token Usage
```
📊 TOTAL TOKEN USAGE (Multi-Pass):
   Input tokens: 24,512
   Output tokens: 19,234
   Total tokens: 43,746
   Estimated cost: $0.3624
```

## Client-Side Integration

### New SSE Event Type

```typescript
type SSEEvent =
  | { type: 'init', chatId: string, demo: string }
  | { type: 'build_step', step: string }
  | { type: 'chunk_progress', phase: number, totalPhases: number, message: string }
  | { type: 'chunk', content: string }
  | { type: 'complete', chatId: string, demo: string }
  | { type: 'error', error: string }
```

### Example Client Handler

```typescript
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)

  switch (data.type) {
    case 'chunk_progress':
      // Update progress UI
      setProgress({
        phase: data.phase,
        total: data.totalPhases,
        message: data.message
      })
      break

    case 'complete':
      // Generation finished
      setPreviewUrl(data.demo)
      break
  }
}
```

## Testing

### Simple Test (Should NOT use chunking)

```typescript
const simplePrompt = `Build a todo list app with:
- Add/delete todos
- Mark complete
- Filter by status`

// Expected: Single-pass generation
// Complexity: 2 pages, ~4,000 tokens
```

### Complex Test (SHOULD use chunking)

```typescript
const complexPrompt = `Build San Francisco Bay View digital newspaper with:
- Homepage with featured articles
- Article detail page
- Podcast player page
- Archive search page
- AI chat interface
- Subscription page
- Analytics insights page`

// Expected: Multi-pass chunking (3-phase)
// Complexity: 7 pages, ~18,500 tokens
```

## Success Metrics

Based on testing with Bay View and GBOS:

| Metric | Target | Current |
|--------|--------|---------|
| Per-phase success rate | >95% | Testing required |
| Merge success rate | >90% | Testing required |
| Overall success rate | >85% | Testing required |
| Time multiplier | 3-5x | ~4x (estimated) |
| Token efficiency | 70-80% | Testing required |

## Known Limitations

1. **Chat Continuations**: Chunking only works for initial messages (not follow-ups)
2. **Subagents Mode**: Chunking is not compatible with subagents mode (uses existing orchestrator instead)
3. **Retry Logic**: Each phase retries once on failure, but overall system doesn't retry entire plan
4. **Import Conflicts**: Simple deduplication may miss complex import patterns
5. **State Management**: Cross-chunk state may require manual fixes in some cases

## Future Improvements

1. **Smart Retry**: Retry entire plan if merge fails
2. **AST-Based Merging**: Use TypeScript AST parser for smarter code merging
3. **Chunk Caching**: Cache successful chunks to avoid regeneration
4. **Progressive Validation**: Validate each chunk before proceeding
5. **Dynamic Chunking**: Adjust chunk sizes based on actual token usage
6. **Client UI**: Add visual progress bar and phase indicators

## Troubleshooting

### Chunking not triggering when expected

**Check**:
1. Is page count >5 OR estimated tokens >10,000?
2. Is this a new chat (`previousMessages.length === 0`)?
3. Is subagents mode disabled?

### Phase failing validation

**Solution**: Each phase retries once automatically. Check logs for specific validation errors.

### Merge producing invalid code

**Solution**: The merger has auto-fix capabilities. Check validation logs for specific issues. May need to adjust phase prompts.

### Token usage higher than expected

**Expected**: Multi-pass uses ~20-30% more tokens due to overlap (system prompts, context). This is acceptable for complex apps that couldn't be generated otherwise.

## Implementation Status

**Completed (March 3, 2026)**:
- ✅ Complexity analyzer
- ✅ Chunk planner
- ✅ Multi-pass generator
- ✅ Chunk merger
- ✅ API integration
- ✅ Console logging
- ✅ Progress streaming

**In Progress**:
- 🚧 Testing with real PRDs
- 🚧 Performance tuning
- 🚧 Edge case handling

**Planned**:
- ⏳ Client UI enhancements
- ⏳ Advanced retry logic
- ⏳ AST-based merging
- ⏳ Chunk caching

---

**Last Updated**: March 3, 2026
**Status**: Integration complete, testing in progress
