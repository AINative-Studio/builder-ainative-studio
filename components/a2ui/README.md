# A2UI Dynamic Preview System

The **A2UI (Agent-to-UI)** system enables AI agents to control and update UI components in real-time through a WebSocket-based protocol. This allows for dynamic, interactive previews that respond to both agent updates and user interactions.

## Features

- **Agent-Controlled Layouts**: AI agents can dynamically create and modify UI layouts
- **Real-Time Updates**: WebSocket-based communication for instant UI changes
- **Interactive Components**: Buttons, forms, and other elements work with full interactivity
- **Video Integration**: Support for video embedding (v0.10 protocol)
- **Bidirectional Communication**: User actions are sent back to the agent
- **Fallback Support**: Graceful degradation to static preview when A2UI is unavailable

## Architecture

```
┌─────────────┐         WebSocket          ┌──────────────┐
│             │ ◄──────────────────────────►│              │
│  AI Agent   │   Render/Update Messages    │  A2UI Client │
│             │                             │   (Browser)  │
│             │ ◄──────────────────────────►│              │
└─────────────┘      Action Messages        └──────────────┘
```

## Components

### 1. ComponentMapper

Maps A2UI component specifications to React components.

```typescript
import { ComponentMapper } from '@/components/a2ui'

const component = {
  type: 'button',
  id: 'submit-btn',
  props: { variant: 'default' },
  children: 'Submit',
  events: {
    onClick: 'handleSubmit'
  }
}

<ComponentMapper component={component} onAction={handleAction} />
```

**Supported Component Types:**

- **Layout**: `container`, `flex`, `grid`
- **UI**: `button`, `input`, `textarea`, `label`, `select`, `checkbox`, `radio`
- **Display**: `card`, `badge`, `separator`, `progress`
- **Navigation**: `tabs`, `tab-content`
- **Content**: `text`, `heading`, `image`, `video`
- **Forms**: `form`, `field`

### 2. AgentConnection

Manages WebSocket connection to the agent.

```typescript
import { useAgentConnection } from '@/components/a2ui'

const {
  status,
  component,
  error,
  connect,
  disconnect,
  sendAction,
  isConnected
} = useAgentConnection({
  url: '/api/a2ui',
  chatId: 'chat-123',
  reconnect: true,
  onMessage: (message) => console.log('Received:', message),
  onConnect: () => console.log('Connected'),
  onDisconnect: () => console.log('Disconnected'),
  onError: (error) => console.error('Error:', error)
})
```

**Connection Status:**
- `DISCONNECTED`: Not connected
- `CONNECTING`: Establishing connection
- `CONNECTED`: Active connection
- `RECONNECTING`: Attempting to reconnect
- `ERROR`: Connection error

### 3. A2UIPreview

Main preview component with controls and status display.

```typescript
import { A2UIPreview } from '@/components/a2ui'

<A2UIPreview
  chatId="chat-123"
  agentUrl="/api/a2ui"
  autoConnect={true}
  showControls={true}
  showStatus={true}
  enableVideo={true}
  onComponentRender={(component) => console.log('Rendered:', component)}
  onAction={(action, context) => console.log('Action:', action, context)}
  onError={(error) => console.error('Error:', error)}
/>
```

### 4. A2UIPreviewWithFallback

Preview with automatic fallback to static iframe.

```typescript
import { A2UIPreviewWithFallback } from '@/components/a2ui'

<A2UIPreviewWithFallback
  chatId="chat-123"
  enableA2UI={true}
  fallbackSrc="/api/preview/chat-123"
  showControls={false}
  showStatus={true}
/>
```

## A2UI Protocol

### Message Types

#### 1. Render Message
Agent sends this to render a new component.

```json
{
  "type": "render",
  "payload": {
    "component": {
      "type": "card",
      "id": "welcome-card",
      "props": {
        "title": "Welcome",
        "description": "Get started with A2UI"
      },
      "children": [
        {
          "type": "button",
          "id": "start-btn",
          "props": { "variant": "default" },
          "children": "Get Started",
          "events": {
            "onClick": "startTutorial"
          }
        }
      ]
    },
    "mode": "replace"
  },
  "timestamp": 1234567890
}
```

#### 2. Update Message
Agent sends this to update an existing component.

```json
{
  "type": "update",
  "payload": {
    "componentId": "progress-bar",
    "updates": {
      "props": {
        "value": 75
      }
    }
  },
  "timestamp": 1234567890
}
```

#### 3. Action Message
Client sends this when user interacts with a component.

```json
{
  "type": "action",
  "payload": {
    "action": "handleSubmit",
    "context": {
      "componentId": "submit-btn",
      "event": "onClick",
      "value": null,
      "data": {}
    }
  },
  "timestamp": 1234567890
}
```

#### 4. State Message
Agent sends this to update global state.

```json
{
  "type": "state",
  "payload": {
    "state": {
      "user": { "name": "John" },
      "theme": "dark"
    }
  },
  "timestamp": 1234567890
}
```

#### 5. Error Message
Agent sends this to report errors.

```json
{
  "type": "error",
  "payload": {
    "message": "Failed to render component",
    "code": "RENDER_ERROR"
  },
  "timestamp": 1234567890
}
```

## Component Specification

### Basic Structure

```typescript
interface A2UIComponent {
  type: string                    // Component type (e.g., 'button', 'card')
  id: string                      // Unique identifier
  props?: Record<string, any>     // Component properties
  children?: A2UIComponent[] | string  // Nested components or text
  layout?: {                      // Layout configuration
    width?: string | number
    height?: string | number
    display?: 'block' | 'flex' | 'grid'
    flexDirection?: 'row' | 'column'
    gap?: string | number
    padding?: string | number
    margin?: string | number
  }
  style?: Record<string, any>     // Custom CSS styles
  events?: {                      // Event handlers
    onClick?: string
    onChange?: string
    onSubmit?: string
  }
}
```

### Example: Dashboard Layout

```typescript
const dashboard: A2UIComponent = {
  type: 'container',
  id: 'dashboard',
  layout: {
    padding: '2rem',
  },
  children: [
    {
      type: 'heading',
      id: 'title',
      props: { level: 1 },
      children: 'Analytics Dashboard'
    },
    {
      type: 'grid',
      id: 'metrics',
      layout: {
        columns: 'repeat(3, 1fr)',
        gap: '1rem'
      },
      children: [
        {
          type: 'card',
          id: 'users-card',
          props: {
            title: 'Total Users',
            description: '1,234 active users'
          },
          children: [
            {
              type: 'text',
              id: 'users-count',
              props: { variant: 'h2' },
              children: '1,234'
            }
          ]
        },
        {
          type: 'card',
          id: 'revenue-card',
          props: {
            title: 'Revenue',
            description: '$45,678 this month'
          },
          children: [
            {
              type: 'text',
              id: 'revenue-amount',
              props: { variant: 'h2' },
              children: '$45,678'
            }
          ]
        },
        {
          type: 'card',
          id: 'growth-card',
          props: {
            title: 'Growth',
            description: '+23% from last month'
          },
          children: [
            {
              type: 'text',
              id: 'growth-percent',
              props: { variant: 'h2' },
              children: '+23%'
            }
          ]
        }
      ]
    }
  ]
}
```

## Integration with PreviewPanel

The A2UI system is integrated into the existing preview panel with a toggle button:

```typescript
// In PreviewPanel component
const [useA2UI, setUseA2UI] = useState(false)

// Toggle button in navigation
<WebPreviewNavigationButton
  onClick={() => setUseA2UI(!useA2UI)}
  tooltip={useA2UI ? 'Switch to static preview' : 'Enable A2UI dynamic preview'}
>
  <Zap className={cn('h-4 w-4', useA2UI && 'text-blue-600')} />
</WebPreviewNavigationButton>

// Conditional rendering
{useA2UI ? (
  <A2UIPreviewWithFallback
    chatId={currentChat.id}
    fallbackSrc={currentChat.demo}
  />
) : (
  <WebPreviewBody src={currentChat.demo} />
)}
```

## API Endpoints

### WebSocket Endpoint
```
ws://localhost:3000/api/a2ui?chatId=xxx
```

### Polling Endpoint (Alternative)
```
GET /api/a2ui/poll?chatId=xxx&timeout=30000
```

### Action Endpoint
```
POST /api/a2ui/action
Body: { chatId, action, context }
```

## Video Support (v0.10)

A2UI supports video embedding through the `video` component type:

```typescript
{
  type: 'video',
  id: 'demo-video',
  props: {
    src: 'https://example.com/video.mp4',
    autoPlay: false,
    controls: true,
    loop: false
  }
}
```

## Development

### Running Locally

1. Start the Next.js development server:
```bash
npm run dev
```

2. Open a chat and toggle the A2UI preview mode (lightning bolt icon)

3. The preview will attempt to connect to `/api/a2ui`

### Testing with Mock Agent

Create a test script to send A2UI messages:

```typescript
// test-a2ui.ts
const ws = new WebSocket('ws://localhost:3000/api/a2ui?chatId=test-123')

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'render',
    payload: {
      component: {
        type: 'card',
        id: 'test-card',
        props: { title: 'Test Card' },
        children: 'This is a test from the agent'
      }
    }
  }))
}
```

## Production Considerations

1. **WebSocket Server**: Implement a dedicated WebSocket server (Socket.io, ws library)
2. **Authentication**: Add JWT token validation for WebSocket connections
3. **Rate Limiting**: Prevent excessive message flooding
4. **Message Queue**: Use Redis for message persistence and queuing
5. **Monitoring**: Track connection status, message throughput, errors
6. **Scaling**: Use Redis pub/sub for multi-instance deployments

## Troubleshooting

### Connection Issues

**Problem**: WebSocket connection fails
**Solution**: Check that WebSocket server is running and CORS is configured

**Problem**: Messages not received
**Solution**: Verify chatId parameter and check browser console for errors

### Component Rendering Issues

**Problem**: Component type not found
**Solution**: Check that component type is registered in `componentRegistry`

**Problem**: Events not firing
**Solution**: Verify event handler names match between component and agent

## Future Enhancements

- [ ] Semantic search integration (v0.11)
- [ ] Component state persistence
- [ ] Undo/redo for agent actions
- [ ] Component animation support
- [ ] Custom component registration
- [ ] Performance monitoring dashboard

## License

Part of the AINative Builder Studio platform.
