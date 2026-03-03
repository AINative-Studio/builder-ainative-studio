"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DesignTokenUploadDialog } from "@/components/design-tokens/upload-dialog";
import { DesignTokenPreview } from "@/components/design-tokens/preview";
import { VersionHistory } from "@/components/design-tokens/version-history";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DesignTokenRecord, DesignTokenVersion } from "@/lib/design-tokens/types";
import { useToast } from "@/components/ui/use-toast";
import {
  Upload,
  Search,
  Eye,
  CheckCircle2,
  Trash2,
  Edit,
  History,
  Sparkles,
} from "lucide-react";

export default function DesignTokensPage() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<DesignTokenRecord[]>([]);
  const [filteredTokens, setFilteredTokens] = useState<DesignTokenRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [previewToken, setPreviewToken] = useState<DesignTokenRecord | null>(null);
  const [versionHistoryToken, setVersionHistoryToken] = useState<DesignTokenRecord | null>(null);
  const [versions, setVersions] = useState<DesignTokenVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Fetch design tokens
  const fetchTokens = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/design-tokens");
      if (!response.ok) throw new Error("Failed to fetch design tokens");

      const data = await response.json();
      setTokens(data.tokens || []);
      setFilteredTokens(data.tokens || []);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load design tokens",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, []);

  // Search filter
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTokens(tokens);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredTokens(
        tokens.filter((token) =>
          token.name.toLowerCase().includes(query) ||
          token.currentVersion.toLowerCase().includes(query)
        )
      );
    }
    setCurrentPage(1);
  }, [searchQuery, tokens]);

  // Pagination
  const totalPages = Math.ceil(filteredTokens.length / itemsPerPage);
  const paginatedTokens = filteredTokens.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Activate token
  const handleActivate = async (tokenId: string) => {
    try {
      const response = await fetch(`/api/design-tokens/${tokenId}/activate`, {
        method: "PUT",
      });

      if (!response.ok) throw new Error("Failed to activate");

      toast({
        title: "Success",
        description: "Design token activated",
      });

      fetchTokens();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to activate",
        variant: "destructive",
      });
    }
  };

  // Delete token
  const handleDelete = async (tokenId: string, tokenName: string) => {
    if (!confirm(`Are you sure you want to delete "${tokenName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/design-tokens/${tokenId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete");

      toast({
        title: "Success",
        description: "Design token deleted",
      });

      fetchTokens();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete",
        variant: "destructive",
      });
    }
  };

  // Show version history
  const handleShowVersionHistory = async (token: DesignTokenRecord) => {
    try {
      const response = await fetch(`/api/design-tokens/${token.id}/versions`);
      if (!response.ok) throw new Error("Failed to fetch versions");

      const data = await response.json();
      setVersions(data.versions || []);
      setVersionHistoryToken(token);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load versions",
        variant: "destructive",
      });
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(date));
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-8 w-8" />
              Design Tokens
            </h1>
            <p className="text-muted-foreground mt-2">
              Manage and apply custom design systems to your generated UIs
            </p>
          </div>
          <Button onClick={() => setUploadDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Design System
          </Button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or version..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {filteredTokens.length} {filteredTokens.length === 1 ? "token" : "tokens"}
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading design tokens...
          </div>
        ) : paginatedTokens.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-muted-foreground">
              {searchQuery ? "No design tokens found matching your search" : "No design tokens yet"}
            </p>
            {!searchQuery && (
              <Button onClick={() => setUploadDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Your First Design System
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTokens.map((token) => (
                    <TableRow
                      key={token.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setPreviewToken(token)}
                    >
                      <TableCell className="font-medium">{token.name}</TableCell>
                      <TableCell className="font-mono text-sm">{token.currentVersion}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(token.createdAt)}
                      </TableCell>
                      <TableCell>
                        {token.isActive ? (
                          <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPreviewToken(token)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleShowVersionHistory(token)}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          {!token.isActive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleActivate(token.id)}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(token.id, token.name)}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Upload Dialog */}
      <DesignTokenUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onSuccess={fetchTokens}
      />

      {/* Preview Dialog */}
      {previewToken && (
        <Dialog open={!!previewToken} onOpenChange={() => setPreviewToken(null)}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{previewToken.name}</DialogTitle>
              <DialogDescription>
                Version {previewToken.currentVersion} • Created {formatDate(previewToken.createdAt)}
              </DialogDescription>
            </DialogHeader>

            <DesignTokenPreview tokens={previewToken.tokens} />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPreviewToken(null)}>
                Close
              </Button>
              {!previewToken.isActive && (
                <Button onClick={() => {
                  handleActivate(previewToken.id);
                  setPreviewToken(null);
                }}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Activate
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Version History Dialog */}
      {versionHistoryToken && (
        <VersionHistory
          designTokenId={versionHistoryToken.id}
          versions={versions}
          open={!!versionHistoryToken}
          onOpenChange={(open) => !open && setVersionHistoryToken(null)}
          onRevert={fetchTokens}
        />
      )}
    </div>
  );
}
