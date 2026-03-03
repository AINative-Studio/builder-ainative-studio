"use client";

import { useState } from "react";
import { DesignTokenVersion } from "@/lib/design-tokens/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DesignTokenPreview } from "./preview";
import { RotateCcw, Eye, Calendar, User } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

interface VersionHistoryProps {
  designTokenId: string;
  versions: DesignTokenVersion[];
  onRevert?: (versionId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionHistory({ designTokenId, versions, onRevert, open, onOpenChange }: VersionHistoryProps) {
  const { toast } = useToast();
  const [selectedVersion, setSelectedVersion] = useState<DesignTokenVersion | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isReverting, setIsReverting] = useState(false);

  const handlePreview = (version: DesignTokenVersion) => {
    setSelectedVersion(version);
    setShowPreview(true);
  };

  const handleRevert = async (version: DesignTokenVersion) => {
    if (!confirm(`Are you sure you want to revert to version ${version.version}? This will create a new version with these tokens.`)) {
      return;
    }

    setIsReverting(true);

    try {
      const response = await fetch(`/api/design-tokens/${designTokenId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id }),
      });

      if (!response.ok) {
        throw new Error("Failed to revert version");
      }

      toast({
        title: "Success",
        description: `Reverted to version ${version.version}`,
      });

      onRevert?.(version.id);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to revert",
        variant: "destructive",
      });
    } finally {
      setIsReverting(false);
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(date));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>
              View and manage previous versions of this design system
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-4">
              {versions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No version history available
                </div>
              ) : (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />

                  {versions.map((version, index) => (
                    <div key={version.id} className="relative pl-14 pb-8 last:pb-0">
                      {/* Timeline dot */}
                      <div className="absolute left-[19px] top-2 h-3 w-3 rounded-full border-2 border-primary bg-background" />

                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold">Version {version.version}</h4>
                              {index === 0 && (
                                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                  Current
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                <span>{formatDate(version.createdAt)}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                <span>{version.createdBy}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePreview(version)}
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Preview
                            </Button>
                            {index !== 0 && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleRevert(version)}
                                disabled={isReverting}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Revert
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Token summary */}
                        <div className="bg-muted/50 p-3 rounded-lg">
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">Name:</span>{" "}
                              <span className="font-medium">{version.tokens.name}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Primary:</span>{" "}
                              <div className="inline-flex items-center gap-2">
                                <div
                                  className="w-4 h-4 rounded border shadow-sm"
                                  style={{ backgroundColor: version.tokens.colors.primary }}
                                />
                                <span className="font-mono text-xs">{version.tokens.colors.primary}</span>
                              </div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Font:</span>{" "}
                              <span className="font-medium truncate inline-block max-w-[150px]">
                                {version.tokens.typography.fontFamily}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      {selectedVersion && (
        <Dialog open={showPreview} onOpenChange={setShowPreview}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Version {selectedVersion.version} Preview</DialogTitle>
              <DialogDescription>
                Preview of design tokens from {formatDate(selectedVersion.createdAt)}
              </DialogDescription>
            </DialogHeader>

            <DesignTokenPreview tokens={selectedVersion.tokens} />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Close
              </Button>
              <Button onClick={() => handleRevert(selectedVersion)} disabled={isReverting}>
                <RotateCcw className="h-4 w-4 mr-2" />
                {isReverting ? "Reverting..." : "Revert to This Version"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
