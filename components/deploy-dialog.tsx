'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import { Rocket, Loader2, ExternalLink, Cloud, Server } from 'lucide-react'

interface DeployDialogProps {
  generationId: string
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface Platform {
  id: string
  name: string
  icon: React.ReactNode
  requiresToken: boolean
  tokenLabel: string
  tokenPlaceholder: string
}

const platforms: Platform[] = [
  {
    id: 'vercel',
    name: 'Vercel',
    icon: <Cloud className="w-4 h-4" />,
    requiresToken: true,
    tokenLabel: 'Vercel API Token',
    tokenPlaceholder: 'vercel_***********xyz'
  },
  {
    id: 'netlify',
    name: 'Netlify',
    icon: <Cloud className="w-4 h-4" />,
    requiresToken: true,
    tokenLabel: 'Netlify API Token',
    tokenPlaceholder: 'nfp_***********xyz'
  },
  {
    id: 'railway',
    name: 'Railway',
    icon: <Server className="w-4 h-4" />,
    requiresToken: true,
    tokenLabel: 'Railway API Token',
    tokenPlaceholder: 'railway_***********xyz'
  },
  {
    id: 'ainative',
    name: 'AINative Cloud',
    icon: <Rocket className="w-4 h-4" />,
    requiresToken: false,
    tokenLabel: 'API Key',
    tokenPlaceholder: ''
  }
]

export function DeployDialog({
  generationId,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange
}: DeployDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [platform, setPlatform] = useState<string>('')
  const [apiToken, setApiToken] = useState('')
  const [saveCredentials, setSaveCredentials] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null)
  const [savedCredentials, setSavedCredentials] = useState<
    Array<{ id: string; platform: string; maskedToken: string }>
  >([])
  const { toast } = useToast()

  // Use controlled or internal open state
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setOpen = controlledOnOpenChange || setInternalOpen

  // Fetch saved credentials on mount
  useEffect(() => {
    fetchSavedCredentials()
  }, [])

  // Auto-fill credentials when platform changes
  useEffect(() => {
    if (platform) {
      const credential = savedCredentials.find((c) => c.platform === platform)
      if (credential) {
        // In production, we'd fetch the actual token from the server
        // For now, we just indicate that credentials are saved
        toast({
          title: 'Credentials loaded',
          description: `Using saved credentials for ${platforms.find((p) => p.id === platform)?.name}`
        })
      }
    }
  }, [platform, savedCredentials])

  const fetchSavedCredentials = async () => {
    try {
      const response = await fetch('/api/credentials', {
        headers: {
          'Accept': 'application/json',
        },
        credentials: 'same-origin',
      })

      // Check if user is authenticated
      if (response.status === 401) {
        // User not authenticated - this is expected, don't show error
        return
      }

      if (response.ok) {
        const data = await response.json()
        setSavedCredentials(data.platforms || [])
      }
    } catch (error) {
      // Silently ignore errors - credentials feature is optional
      // Only log in development
      if (process.env.NODE_ENV === 'development') {
        console.debug('Credentials API not available:', error)
      }
    }
  }

  const handleDeploy = async () => {
    if (!platform) {
      toast({
        title: 'Platform required',
        description: 'Please select a deployment platform',
        variant: 'destructive'
      })
      return
    }

    const selectedPlatform = platforms.find((p) => p.id === platform)
    if (selectedPlatform?.requiresToken && !apiToken) {
      const hasSavedCredential = savedCredentials.some(
        (c) => c.platform === platform
      )
      if (!hasSavedCredential) {
        toast({
          title: 'API Token required',
          description: `Please enter your ${selectedPlatform.name} API token`,
          variant: 'destructive'
        })
        return
      }
    }

    setLoading(true)
    setDeploymentUrl(null)

    try {
      // Save credentials if requested
      if (saveCredentials && apiToken) {
        await fetch('/api/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform,
            apiToken
          })
        })
      }

      // Deploy the project
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationId,
          platform,
          apiToken: apiToken || undefined
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Deployment failed')
      }

      const data = await response.json()

      setDeploymentUrl(data.url)
      toast({
        title: 'Deployment started',
        description: `Your project is being deployed to ${selectedPlatform?.name}`
      })

      // Refresh saved credentials list
      if (saveCredentials) {
        await fetchSavedCredentials()
      }
    } catch (error) {
      console.error('Deployment error:', error)
      toast({
        title: 'Deployment failed',
        description:
          error instanceof Error ? error.message : 'Failed to deploy project',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setOpen(false)
      // Reset form after a delay
      setTimeout(() => {
        setPlatform('')
        setApiToken('')
        setSaveCredentials(false)
        setDeploymentUrl(null)
      }, 300)
    }
  }

  const selectedPlatform = platforms.find((p) => p.id === platform)
  const hasSavedCredential = savedCredentials.some((c) => c.platform === platform)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Deploy Your Project</DialogTitle>
          <DialogDescription>
            Choose a platform and deploy your generated project with one click.
          </DialogDescription>
        </DialogHeader>

        {deploymentUrl ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-2">
                <Rocket className="w-5 h-5" />
                <span className="font-medium">Deployment in progress</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Your project is being deployed. This may take a few minutes.
              </p>
              <a
                href={deploymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                View deployment status
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            <DialogFooter>
              <Button onClick={handleClose} variant="outline">
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="platform">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger id="platform" className="w-full">
                  <SelectValue placeholder="Select a platform" />
                </SelectTrigger>
                <SelectContent>
                  {platforms.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        {p.icon}
                        <span>{p.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPlatform?.requiresToken && !hasSavedCredential && (
              <div className="space-y-2">
                <Label htmlFor="api-token">{selectedPlatform.tokenLabel}</Label>
                <Input
                  id="api-token"
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder={selectedPlatform.tokenPlaceholder}
                />
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="save-credentials"
                    checked={saveCredentials}
                    onCheckedChange={(checked) =>
                      setSaveCredentials(checked === true)
                    }
                  />
                  <Label
                    htmlFor="save-credentials"
                    className="text-sm font-normal cursor-pointer"
                  >
                    Save credentials for future deployments
                  </Label>
                </div>
              </div>
            )}

            {selectedPlatform?.requiresToken && hasSavedCredential && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  Using saved credentials for {selectedPlatform.name}
                </p>
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleClose} variant="outline" disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleDeploy} disabled={loading || !platform}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4 mr-2" />
                    Deploy
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
