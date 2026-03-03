'use client'

import { useState, useEffect } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppHeader } from '@/components/shared/app-header'
import {
  Cloud,
  Server,
  Rocket,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  Shield
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface Credential {
  id: string
  platform: string
  maskedToken: string
  createdAt: string
  isValid?: boolean
}

interface Platform {
  id: string
  name: string
  icon: React.ReactNode
  tokenLabel: string
  tokenPlaceholder: string
}

const platforms: Platform[] = [
  {
    id: 'vercel',
    name: 'Vercel',
    icon: <Cloud className="w-4 h-4" />,
    tokenLabel: 'Vercel API Token',
    tokenPlaceholder: 'Enter your Vercel API token'
  },
  {
    id: 'netlify',
    name: 'Netlify',
    icon: <Cloud className="w-4 h-4" />,
    tokenLabel: 'Netlify API Token',
    tokenPlaceholder: 'Enter your Netlify API token'
  },
  {
    id: 'railway',
    name: 'Railway',
    icon: <Server className="w-4 h-4" />,
    tokenLabel: 'Railway API Token',
    tokenPlaceholder: 'Enter your Railway API token'
  }
]

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null)
  const [newPlatform, setNewPlatform] = useState('')
  const [newToken, setNewToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    fetchCredentials()
  }, [])

  const fetchCredentials = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/credentials')
      if (!response.ok) {
        throw new Error('Failed to fetch credentials')
      }

      const data = await response.json()
      setCredentials(data.credentials || [])
    } catch (error) {
      console.error('Error fetching credentials:', error)
      toast({
        title: 'Failed to load credentials',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddCredential = async () => {
    if (!newPlatform || !newToken) {
      toast({
        title: 'Missing information',
        description: 'Please select a platform and enter an API token',
        variant: 'destructive'
      })
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: newPlatform,
          apiToken: newToken
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to save credential')
      }

      toast({
        title: 'Credential saved',
        description: `Successfully saved credentials for ${platforms.find((p) => p.id === newPlatform)?.name}`
      })

      setShowAddDialog(false)
      setNewPlatform('')
      setNewToken('')
      await fetchCredentials()
    } catch (error) {
      console.error('Error saving credential:', error)
      toast({
        title: 'Failed to save credential',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCredential = async () => {
    if (!selectedCredential) return

    setDeleting(true)
    try {
      const response = await fetch(`/api/credentials/${selectedCredential.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to delete credential')
      }

      toast({
        title: 'Credential deleted',
        description: 'Successfully deleted the credential'
      })

      setShowDeleteDialog(false)
      setSelectedCredential(null)
      await fetchCredentials()
    } catch (error) {
      console.error('Error deleting credential:', error)
      toast({
        title: 'Failed to delete credential',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    } finally {
      setDeleting(false)
    }
  }

  const handleTestConnection = async (credential: Credential) => {
    setTesting(credential.id)
    try {
      const response = await fetch(`/api/credentials/${credential.id}/test`, {
        method: 'POST'
      })

      const data = await response.json()

      if (data.valid) {
        toast({
          title: 'Connection successful',
          description: `Your ${credential.platform} credentials are valid`
        })
      } else {
        toast({
          title: 'Connection failed',
          description: data.message || 'Invalid credentials',
          variant: 'destructive'
        })
      }

      // Update credential validity
      setCredentials((prev) =>
        prev.map((c) =>
          c.id === credential.id ? { ...c, isValid: data.valid } : c
        )
      )
    } catch (error) {
      console.error('Error testing connection:', error)
      toast({
        title: 'Test failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    } finally {
      setTesting(null)
    }
  }

  const getPlatformIcon = (platformId: string) => {
    const platform = platforms.find((p) => p.id === platformId)
    return platform?.icon || <Cloud className="w-4 h-4" />
  }

  const getPlatformName = (platformId: string) => {
    const platform = platforms.find((p) => p.id === platformId)
    return platform?.name || platformId
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black">
        <AppHeader />
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      <AppHeader />
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Deployment Credentials
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage your API tokens for deployment platforms
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Saved Credentials</CardTitle>
                <CardDescription>
                  {credentials.length} credential{credentials.length !== 1 ? 's' : ''} saved
                </CardDescription>
              </div>
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Credential
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {credentials.length === 0 ? (
              <div className="text-center py-12">
                <Shield className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No credentials saved
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  Add your API tokens to deploy projects quickly
                </p>
                <Button onClick={() => setShowAddDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Credential
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead>API Token</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {credentials.map((credential) => (
                      <TableRow key={credential.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getPlatformIcon(credential.platform)}
                            <span className="font-medium">
                              {getPlatformName(credential.platform)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                            {credential.maskedToken}
                          </code>
                        </TableCell>
                        <TableCell>
                          {credential.isValid === true && (
                            <Badge
                              variant="outline"
                              className="bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400"
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Valid
                            </Badge>
                          )}
                          {credential.isValid === false && (
                            <Badge
                              variant="outline"
                              className="bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400"
                            >
                              <XCircle className="w-3 h-3 mr-1" />
                              Invalid
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {new Date(credential.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTestConnection(credential)}
                              disabled={testing === credential.id}
                            >
                              {testing === credential.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                'Test'
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedCredential(credential)
                                setShowDeleteDialog(true)
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Credential Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Deployment Credential</DialogTitle>
            <DialogDescription>
              Add your API token to deploy projects to this platform
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="platform">Platform</Label>
              <Select value={newPlatform} onValueChange={setNewPlatform}>
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

            {newPlatform && (
              <div className="space-y-2">
                <Label htmlFor="token">
                  {platforms.find((p) => p.id === newPlatform)?.tokenLabel}
                </Label>
                <Input
                  id="token"
                  type="password"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder={platforms.find((p) => p.id === newPlatform)?.tokenPlaceholder}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Your token is encrypted and stored securely
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setShowAddDialog(false)
                setNewPlatform('')
                setNewToken('')
              }}
              variant="outline"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleAddCredential} disabled={saving || !newPlatform || !newToken}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Credential'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Credential</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this credential? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {selectedCredential && (
            <div className="rounded-lg border p-4 bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center gap-2 mb-2">
                {getPlatformIcon(selectedCredential.platform)}
                <span className="font-medium">
                  {getPlatformName(selectedCredential.platform)}
                </span>
              </div>
              <code className="text-xs bg-white dark:bg-gray-800 px-2 py-1 rounded">
                {selectedCredential.maskedToken}
              </code>
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={() => {
                setShowDeleteDialog(false)
                setSelectedCredential(null)
              }}
              variant="outline"
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button onClick={handleDeleteCredential} variant="destructive" disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
