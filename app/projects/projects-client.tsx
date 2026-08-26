'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, FolderGit2, Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getActiveWorkspaceId,
  WORKSPACE_CHANGED_EVENT,
} from '@/components/workspace-switcher'

interface Project {
  id: string
  name: string
  description?: string | null
  tier: string
  status: string
  organization_id?: string | null
  created_at: string
}

interface TierUsage {
  max: number
  remaining: number
  // The user's real plan name from the API. The banner previously hard-coded
  // "Hobbyist" — but $5 Hobbyist is a dev/API tier, not a Builder membership, so
  // Builder must never mislabel entry users as Hobbyist. Falls back to a neutral
  // label when absent. Refs #6680.
  tier?: string | null
  planName?: string | null
}

export function ProjectsClient({ isAINative }: { isAINative: boolean }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [tierUsage, setTierUsage] = useState<TierUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)

  const load = useCallback(async (wsId: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const qs = wsId ? `?workspaceId=${encodeURIComponent(wsId)}` : ''
      const res = await fetch(`/api/projects${qs}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load projects')
      }
      const data = await res.json()
      setProjects(data.projects ?? [])
      setTierUsage(data.tierUsage ?? data.freeTier ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAINative) {
      setLoading(false)
      return
    }
    const initial = getActiveWorkspaceId()
    setWorkspaceId(initial)
    load(initial)

    const onChange = (e: Event) => {
      const id = (e as CustomEvent).detail?.workspaceId ?? null
      setWorkspaceId(id)
      load(id)
    }
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, onChange)
  }, [isAINative, load])

  const createProject = useCallback(async () => {
    const name = window.prompt('Name your new app (project):')?.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workspaceId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (body.upgradeRequired) {
          setError(
            `You've reached your plan limit of ${body.max} apps. Upgrade to build unlimited full-stack apps.`,
          )
          return
        }
        throw new Error(body.error || 'Failed to create project')
      }
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }, [workspaceId, load])

  if (!isAINative) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <FolderGit2 className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Projects need an AINative account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with AINative to organize your generated apps into workspaces and
          projects.
        </p>
        <Button asChild className="mt-6">
          <Link href="/login">Sign in with AINative</Link>
        </Button>
      </div>
    )
  }

  const atLimit = tierUsage != null && tierUsage.remaining <= 0

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Each project is a generated app in your active workspace.
          </p>
        </div>
        <Button onClick={createProject} disabled={creating || atLimit}>
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          New app
        </Button>
      </div>

      {tierUsage && (
        <div className="mb-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          {atLimit ? (
            <span className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-fuchsia-500" />
              You've used all {tierUsage.max} apps on your plan.
              <a
                href="https://ainative.studio/#pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                Upgrade for unlimited full-stack apps →
              </a>
            </span>
          ) : (
            <span>
              {(tierUsage.planName || tierUsage.tier) ? (
                <>{tierUsage.planName || tierUsage.tier} plan: </>
              ) : (
                <>Your plan: </>
              )}
              <strong>{tierUsage.remaining}</strong> of{' '}
              <strong>{tierUsage.max}</strong> apps remaining.
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <FolderGit2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No apps yet in this workspace. Create your first one.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-border bg-background p-4 transition-colors hover:border-foreground/30"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{p.name}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {p.tier}
                </span>
              </div>
              {p.description && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {p.description}
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {new Date(p.created_at).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
