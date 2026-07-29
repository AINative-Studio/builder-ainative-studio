'use client'

/**
 * Workspace switcher — lists the user's AINative workspaces (organizations)
 * and remembers the active one. The active workspace scopes project listing
 * and new-app creation (each generated app is a core Project under a
 * workspace). Renders nothing for non-AINative (guest/local) sessions.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Check, ChevronsUpDown, Building2, Plus, Lock } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

interface PlanStatus {
  tier: string
  workspaces: { used: number; max: number; remaining: number; unlimited: boolean }
  projects: { used: number; max: number; remaining: number; unlimited: boolean }
}

export interface Workspace {
  id: string
  name: string
  tier: string
  role: string
  is_default: boolean
  project_count: number
}

const ACTIVE_KEY = 'ainative.activeWorkspaceId'
export const WORKSPACE_CHANGED_EVENT = 'ainative:workspace-changed'

/** Read the active workspace id chosen in this browser (if any). */
export function getActiveWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACTIVE_KEY)
}

export function WorkspaceSwitcher() {
  const { data: session } = useSession()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<PlanStatus | null>(null)
  const [creating, setCreating] = useState(false)

  const isAINative = (session as any)?.accessToken != null

  const loadWorkspaces = useCallback(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : { workspaces: [] }))
      .then((data) => {
        if (cancelled) return
        const list: Workspace[] = data.workspaces ?? []
        setWorkspaces(list)
        const stored = getActiveWorkspaceId()
        const initial =
          list.find((w) => w.id === stored)?.id ??
          list.find((w) => w.is_default)?.id ??
          list[0]?.id ??
          null
        setActiveId(initial)
        if (initial) window.localStorage.setItem(ACTIVE_KEY, initial)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isAINative) return
    const cleanup = loadWorkspaces()
    // Plan status drives the workspace-limit UX (free = 1 workspace).
    fetch('/api/plan').then((r) => (r.ok ? r.json() : null)).then((p) => p && setPlan(p)).catch(() => {})
    return cleanup
  }, [isAINative, loadWorkspaces])

  const atWorkspaceLimit =
    plan != null && !plan.workspaces.unlimited && plan.workspaces.remaining <= 0

  const select = useCallback((id: string) => {
    setActiveId(id)
    window.localStorage.setItem(ACTIVE_KEY, id)
    window.dispatchEvent(
      new CustomEvent(WORKSPACE_CHANGED_EVENT, { detail: { workspaceId: id } }),
    )
  }, [])

  const createWorkspace = useCallback(async () => {
    if (atWorkspaceLimit) {
      window.open('https://ainative.studio/#pricing', '_blank')
      return
    }
    const name = window.prompt('New workspace name')?.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.workspace?.id) {
        loadWorkspaces()
        select(body.workspace.id)
      } else if (body.upgradeRequired || res.status === 403) {
        window.alert(
          `Your ${plan?.tier ?? 'free'} plan allows ${plan?.workspaces.max ?? 1} workspace. Upgrade to add more.`,
        )
        window.open('https://ainative.studio/#pricing', '_blank')
      } else {
        window.alert(body.error || 'Could not create workspace')
      }
    } finally {
      setCreating(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atWorkspaceLimit, plan, loadWorkspaces, select])

  if (!isAINative) return null

  const active = workspaces.find((w) => w.id === activeId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 max-w-[220px]">
          <Building2 className="w-4 h-4 shrink-0" />
          <span className="truncate">
            {loading ? 'Loading…' : (active?.name ?? 'Select workspace')}
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.length === 0 && (
          <DropdownMenuItem disabled>No workspaces found</DropdownMenuItem>
        )}
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onClick={() => select(w.id)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2 truncate">
              <span className="truncate">{w.name}</span>
              {w.is_default && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  default
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{w.project_count}</span>
              {w.id === activeId && <Check className="w-4 h-4" />}
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={createWorkspace}
          disabled={creating}
          className="flex items-center gap-2"
        >
          {atWorkspaceLimit ? (
            <>
              <Lock className="w-4 h-4 opacity-70" />
              <span>Upgrade to add workspaces</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              <span>{creating ? 'Creating…' : 'New workspace'}</span>
            </>
          )}
        </DropdownMenuItem>

        {plan && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
              <span className="capitalize">{plan.tier}</span> plan ·{' '}
              {plan.workspaces.unlimited
                ? 'unlimited workspaces'
                : `${plan.workspaces.used}/${plan.workspaces.max} workspace${plan.workspaces.max === 1 ? '' : 's'}`}
              {' · '}
              {plan.projects.unlimited
                ? 'unlimited apps'
                : `${plan.projects.used}/${plan.projects.max} apps`}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
