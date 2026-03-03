# ⚠️ CRITICAL: DO NOT MODIFY THESE FILES

## Working Preview System - LOCKED IN

The following files contain the WORKING preview iframe system. DO NOT MODIFY without explicit permission:

### 1. Preview Panel Component
**File**: `/components/chat/preview-panel.tsx`
**Critical Lines**: 74-83
```tsx
{currentChat?.demo ? (
  <WebPreviewBody
    key={refreshKey}
    src={currentChat.demo.startsWith('/preview/')
      ? `/api/preview/${currentChat.demo.split('/').pop()}`
      : currentChat.demo.startsWith('/api/preview/')
      ? currentChat.demo
      : currentChat.demo
    }
  />
) : (
```
**Purpose**: Correctly maps preview URLs to API routes for iframe display

### 2. API Chat Route
**File**: `/app/api/chat/route.ts`
**Critical Lines**: 181-188
```typescript
// If no v0 demo URL, create a local preview URL using the chat ID
if (!demoUrl && generatedContent) {
  // Store the content with the chat ID so /api/preview/[id] can find it
  storePreview(responseId, generatedContent)
  // Use our local preview page with iframe
  demoUrl = `/preview/${responseId}`
  console.log('Using local preview fallback with chat ID:', responseId)
}
```
**Purpose**: Generates correct preview URL format

### 3. API Preview Route
**File**: `/app/api/preview/[id]/route.ts`
**Purpose**: Serves the HTML with embedded React component
**DO NOT MODIFY**: The entire file is critical for preview rendering

## How The Preview System Works

1. **Chat generates content** → Returns `demo: "/preview/[chatId]"`
2. **Preview panel receives URL** → Transforms to `/api/preview/[chatId]`
3. **Iframe loads** → Shows generated component in preview panel

## Testing the Working System

```bash
# Generate test content
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Create a Dashboard","chatId":"test-id"}'

# View in main UI
open http://localhost:3001/chats/test-id
```

## ⚠️ WARNING

ANY CHANGES TO THE ABOVE FILES MAY BREAK THE PREVIEW SYSTEM.
THE PREVIEW IFRAME IS WORKING PERFECTLY - DO NOT MODIFY!

---
Last verified working: $(date)
Verified by: Human confirmation that preview works in main chat UI