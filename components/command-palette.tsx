"use client"

/**
 * Command Palette Component
 *
 * Cmd+K style command palette for agent workflows (Issue #17)
 *
 * Features:
 * - Fuzzy search with keyboard navigation
 * - Recent and favorite commands
 * - Category filtering
 * - Keyboard shortcuts (Cmd+K to open)
 * - Variable prompting before execution
 * - Progress tracking
 */

import * as React from 'react'
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import {
  Search,
  Star,
  Clock,
  Zap,
  FileCode,
  TestTube,
  Rocket,
  FileText,
  GitPullRequest,
  Terminal,
  Play,
  Heart
} from 'lucide-react'
import { AgentCommand, CommandSearchQuery } from '@/lib/types/agent-commands'
import { getCommandService } from '@/lib/services/agent-command.service'
import { cn } from '@/lib/utils'
import { VariablePromptDialog } from './command-variable-prompt'
import { CommandProgressTracker } from './command-progress-tracker'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  chatId?: string
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  development: <FileCode className="h-4 w-4" />,
  testing: <TestTube className="h-4 w-4" />,
  deployment: <Rocket className="h-4 w-4" />,
  documentation: <FileText className="h-4 w-4" />,
  'code-review': <GitPullRequest className="h-4 w-4" />,
  custom: <Terminal className="h-4 w-4" />,
}

export function CommandPalette({
  open,
  onOpenChange,
  userId,
  chatId
}: CommandPaletteProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [commands, setCommands] = useState<AgentCommand[]>([])
  const [recentCommands, setRecentCommands] = useState<AgentCommand[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedCommand, setSelectedCommand] = useState<AgentCommand | null>(null)
  const [showVariablePrompt, setShowVariablePrompt] = useState(false)
  const [showProgress, setShowProgress] = useState(false)

  const commandService = useMemo(() => getCommandService(), [])

  // Load recent commands on mount
  useEffect(() => {
    if (open && userId) {
      loadRecentCommands()
    }
  }, [open, userId])

  // Search commands when query changes
  useEffect(() => {
    if (open) {
      searchCommands()
    }
  }, [searchQuery, open])

  const loadRecentCommands = async () => {
    try {
      const recent = await commandService.getRecentCommands(userId, 5)
      setRecentCommands(recent)
    } catch (error) {
      console.error('Failed to load recent commands:', error)
    }
  }

  const searchCommands = async () => {
    setIsLoading(true)
    try {
      const query: CommandSearchQuery = {
        query: searchQuery,
        sortBy: searchQuery ? 'relevance' : 'popular',
        limit: 20,
      }

      const result = await commandService.searchCommands(userId, query)
      setCommands(result.commands)
    } catch (error) {
      console.error('Failed to search commands:', error)
      setCommands([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleCommandSelect = (command: AgentCommand) => {
    setSelectedCommand(command)

    // If command has variables, show prompt dialog
    if (command.variables.length > 0) {
      setShowVariablePrompt(true)
    } else {
      // Execute directly if no variables
      executeCommand(command, {})
    }
  }

  const handleVariablesSubmit = async (values: Record<string, any>) => {
    if (selectedCommand) {
      setShowVariablePrompt(false)
      await executeCommand(selectedCommand, values)
    }
  }

  const executeCommand = async (command: AgentCommand, variableValues: Record<string, any>) => {
    try {
      // Close the palette
      onOpenChange(false)

      // Show progress tracker
      setShowProgress(true)

      // Execute the command
      const state = await commandService.executeCommand(command, {
        command,
        variableValues,
        userId,
        chatId,
      })

      // Command execution complete
      console.log('Command executed:', state)
    } catch (error) {
      console.error('Command execution failed:', error)
    }
  }

  const toggleFavorite = async (command: AgentCommand, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const isFavorite = await commandService.toggleFavorite(command.metadata.id, userId)

      // Update local state
      setCommands(prevCommands =>
        prevCommands.map(cmd =>
          cmd.metadata.id === command.metadata.id
            ? { ...cmd, metadata: { ...cmd.metadata, isFavorite } }
            : cmd
        )
      )
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
    }
  }

  // Keyboard shortcut handler
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [open, onOpenChange])

  return (
    <>
      <CommandDialog open={open} onOpenChange={onOpenChange}>
        <CommandInput
          placeholder="Search commands..."
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList>
          <CommandEmpty>
            {isLoading ? 'Searching...' : 'No commands found.'}
          </CommandEmpty>

          {/* Recent Commands */}
          {!searchQuery && recentCommands.length > 0 && (
            <>
              <CommandGroup heading="Recent">
                {recentCommands.map((command) => (
                  <CommandItem
                    key={command.metadata.id}
                    value={command.metadata.id}
                    onSelect={() => handleCommandSelect(command)}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex-shrink-0">
                        {CATEGORY_ICONS[command.metadata.category] || <Terminal className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{command.metadata.name}</span>
                          {command.metadata.shortcut && (
                            <Badge variant="outline" className="text-xs">
                              {command.metadata.shortcut}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {command.metadata.description}
                        </p>
                      </div>
                      <button
                        onClick={(e) => toggleFavorite(command, e)}
                        className="flex-shrink-0 p-1 hover:bg-accent rounded"
                      >
                        <Heart
                          className={cn(
                            "h-4 w-4",
                            command.metadata.isFavorite
                              ? "fill-red-500 text-red-500"
                              : "text-muted-foreground"
                          )}
                        />
                      </button>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Search Results */}
          {commands.length > 0 && (
            <CommandGroup heading={searchQuery ? 'Search Results' : 'All Commands'}>
              {commands.map((command) => (
                <CommandItem
                  key={command.metadata.id}
                  value={command.metadata.id}
                  onSelect={() => handleCommandSelect(command)}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex items-center gap-2 flex-1">
                    <div className="flex-shrink-0">
                      {CATEGORY_ICONS[command.metadata.category] || <Terminal className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{command.metadata.name}</span>
                        {command.metadata.isBuiltIn && (
                          <Badge variant="secondary" className="text-xs">
                            Built-in
                          </Badge>
                        )}
                        {command.metadata.shortcut && (
                          <Badge variant="outline" className="text-xs">
                            {command.metadata.shortcut}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {command.metadata.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {command.metadata.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={(e) => toggleFavorite(command, e)}
                      className="flex-shrink-0 p-1 hover:bg-accent rounded"
                    >
                      <Heart
                        className={cn(
                          "h-4 w-4",
                          command.metadata.isFavorite
                            ? "fill-red-500 text-red-500"
                            : "text-muted-foreground"
                        )}
                      />
                    </button>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>

      {/* Variable Prompt Dialog */}
      {selectedCommand && (
        <VariablePromptDialog
          open={showVariablePrompt}
          onOpenChange={setShowVariablePrompt}
          command={selectedCommand}
          onSubmit={handleVariablesSubmit}
          onCancel={() => {
            setShowVariablePrompt(false)
            setSelectedCommand(null)
          }}
        />
      )}

      {/* Progress Tracker */}
      {selectedCommand && showProgress && (
        <CommandProgressTracker
          command={selectedCommand}
          open={showProgress}
          onOpenChange={setShowProgress}
        />
      )}
    </>
  )
}
