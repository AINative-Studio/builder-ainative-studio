/**
 * A2UI (Agent-to-UI) Dynamic Preview System
 *
 * This module provides components for agent-controlled dynamic UI rendering
 * using the A2UI protocol for real-time communication between AI agents and
 * the preview system.
 *
 * @module components/a2ui
 */

export {
  A2UIPreview,
  A2UIPreviewWithFallback,
  type A2UIPreviewProps,
  type A2UIPreviewWithFallbackProps,
} from './A2UIPreview'

export {
  useAgentConnection,
  AgentConnectionStatus,
  ConnectionStatus,
  type AgentConnectionConfig,
  type A2UIMessage,
  type A2UIRenderMessage,
  type A2UIUpdateMessage,
  type A2UIActionMessage,
  type A2UIStateMessage,
} from './AgentConnection'

export {
  ComponentMapper,
  componentRegistry,
  parseA2UISpec,
  validateA2UIComponent,
  type A2UIComponent,
} from './ComponentMapper'
