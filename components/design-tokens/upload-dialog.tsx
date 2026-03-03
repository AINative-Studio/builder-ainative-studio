"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { HexColorPicker } from "react-colorful";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseJSONTokens, parseCSSVariables, getDefaultTokens } from "@/lib/design-tokens/parsers";
import { validateDesignTokens } from "@/lib/design-tokens/validators";
import { DesignTokens } from "@/lib/design-tokens/types";
import { DesignTokenPreview } from "./preview";
import { AlertCircle, CheckCircle2, Upload, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface DesignTokenUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function DesignTokenUploadDialog({ open, onOpenChange, onSuccess }: DesignTokenUploadDialogProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"json" | "css" | "manual">("json");
  const [tokens, setTokens] = useState<Partial<DesignTokens>>(getDefaultTokens());
  const [jsonInput, setJsonInput] = useState("");
  const [cssInput, setCssInput] = useState("");
  const [validationResult, setValidationResult] = useState<ReturnType<typeof validateDesignTokens> | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Handle JSON file upload
  const handleJSONFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setJsonInput(content);

      try {
        const parsed = parseJSONTokens(content);
        setTokens(parsed);
        const validation = validateDesignTokens(parsed);
        setValidationResult(validation);

        if (validation.valid) {
          toast({
            title: "JSON parsed successfully",
            description: "Design tokens are valid and ready to preview",
          });
        }
      } catch (error) {
        setValidationResult({
          valid: false,
          errors: [{ field: "json", message: error instanceof Error ? error.message : "Invalid JSON" }],
        });
      }
    };
    reader.readAsText(file);
  };

  // Handle CSS file upload
  const handleCSSFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCssInput(content);

      try {
        const parsed = parseCSSVariables(content);
        setTokens(parsed as DesignTokens);
        const validation = validateDesignTokens(parsed as DesignTokens);
        setValidationResult(validation);

        if (validation.valid) {
          toast({
            title: "CSS parsed successfully",
            description: "Design tokens extracted from CSS variables",
          });
        }
      } catch (error) {
        setValidationResult({
          valid: false,
          errors: [{ field: "css", message: error instanceof Error ? error.message : "Invalid CSS" }],
        });
      }
    };
    reader.readAsText(file);
  };

  // Handle manual token updates
  const updateManualToken = (path: string[], value: string) => {
    setTokens(prev => {
      const updated = { ...prev };
      let current: any = updated;

      for (let i = 0; i < path.length - 1; i++) {
        if (!current[path[i]]) current[path[i]] = {};
        current = current[path[i]];
      }

      current[path[path.length - 1]] = value;
      return updated;
    });
  };

  // Generate preview
  const handleGeneratePreview = () => {
    const validation = validateDesignTokens(tokens);
    setValidationResult(validation);

    if (validation.valid) {
      setShowPreview(true);
      toast({
        title: "Preview generated",
        description: "Your design tokens are valid",
      });
    } else {
      toast({
        title: "Validation failed",
        description: `Found ${validation.errors.length} error(s)`,
        variant: "destructive",
      });
    }
  };

  // Save design tokens
  const handleSave = async () => {
    const validation = validateDesignTokens(tokens);

    if (!validation.valid) {
      toast({
        title: "Validation failed",
        description: "Please fix all errors before saving",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      const response = await fetch("/api/design-tokens/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tokens),
      });

      if (!response.ok) {
        throw new Error("Failed to save design tokens");
      }

      toast({
        title: "Success",
        description: "Design tokens saved successfully",
      });

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Upload Design System
          </DialogTitle>
          <DialogDescription>
            Import your design tokens via JSON, CSS variables, or manual entry
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="json">JSON Upload</TabsTrigger>
            <TabsTrigger value="css">CSS Variables</TabsTrigger>
            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
          </TabsList>

          <TabsContent value="json" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="json-file">Upload JSON File</Label>
              <Input
                id="json-file"
                type="file"
                accept=".json"
                onChange={handleJSONFileUpload}
              />
              <p className="text-sm text-muted-foreground">
                Expected format: name, version, colors, typography, spacing
              </p>
            </div>

            {jsonInput && (
              <div className="space-y-2">
                <Label>JSON Preview</Label>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs">
                  {jsonInput}
                </pre>
              </div>
            )}
          </TabsContent>

          <TabsContent value="css" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="css-file">Upload CSS File</Label>
              <Input
                id="css-file"
                type="file"
                accept=".css"
                onChange={handleCSSFileUpload}
              />
              <p className="text-sm text-muted-foreground">
                Will extract CSS custom properties (--color-primary, --font-family, etc.)
              </p>
            </div>

            {cssInput && (
              <div className="space-y-2">
                <Label>Extracted Tokens</Label>
                <div className="bg-muted p-4 rounded-lg space-y-2">
                  <p className="text-sm"><strong>Primary:</strong> {tokens.colors?.primary}</p>
                  <p className="text-sm"><strong>Secondary:</strong> {tokens.colors?.secondary}</p>
                  <p className="text-sm"><strong>Accent:</strong> {tokens.colors?.accent}</p>
                  <p className="text-sm"><strong>Font:</strong> {tokens.typography?.fontFamily}</p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-4 mt-4">
            <div className="space-y-4">
              {/* Name and Version */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Design System Name</Label>
                  <Input
                    id="name"
                    value={tokens.name || ""}
                    onChange={(e) => updateManualToken(["name"], e.target.value)}
                    placeholder="My Brand"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="version">Version</Label>
                  <Input
                    id="version"
                    value={tokens.version || ""}
                    onChange={(e) => updateManualToken(["version"], e.target.value)}
                    placeholder="1.0.0"
                  />
                </div>
              </div>

              <Separator />

              {/* Colors */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm">Colors</h3>
                <div className="grid grid-cols-3 gap-4">
                  {["primary", "secondary", "accent"].map((color) => (
                    <div key={color} className="space-y-2">
                      <Label htmlFor={color} className="capitalize">{color}</Label>
                      <div className="flex gap-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              className="w-10 h-10 rounded border shadow-sm"
                              style={{ backgroundColor: tokens.colors?.[color as keyof typeof tokens.colors] || "#000" }}
                            />
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-3">
                            <HexColorPicker
                              color={tokens.colors?.[color as keyof typeof tokens.colors] || "#000000"}
                              onChange={(newColor) => updateManualToken(["colors", color], newColor)}
                            />
                          </PopoverContent>
                        </Popover>
                        <Input
                          id={color}
                          value={tokens.colors?.[color as keyof typeof tokens.colors] || ""}
                          onChange={(e) => updateManualToken(["colors", color], e.target.value)}
                          placeholder="#3B82F6"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Typography */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm">Typography</h3>
                <div className="space-y-2">
                  <Label htmlFor="font-family">Font Family</Label>
                  <Input
                    id="font-family"
                    value={tokens.typography?.fontFamily || ""}
                    onChange={(e) => updateManualToken(["typography", "fontFamily"], e.target.value)}
                    placeholder="Inter, sans-serif"
                  />
                </div>

                <div className="grid grid-cols-5 gap-3">
                  {["xs", "sm", "base", "lg", "xl"].map((size) => (
                    <div key={size} className="space-y-2">
                      <Label htmlFor={`size-${size}`} className="uppercase text-xs">{size}</Label>
                      <Input
                        id={`size-${size}`}
                        value={tokens.typography?.sizes?.[size as keyof typeof tokens.typography.sizes] || ""}
                        onChange={(e) => updateManualToken(["typography", "sizes", size], e.target.value)}
                        placeholder="16px"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Spacing */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm">Spacing</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="base-unit">Base Unit</Label>
                    <Input
                      id="base-unit"
                      value={tokens.spacing?.baseUnit || ""}
                      onChange={(e) => updateManualToken(["spacing", "baseUnit"], e.target.value)}
                      placeholder="4px"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scale">Scale (comma-separated)</Label>
                    <Input
                      id="scale"
                      value={tokens.spacing?.scale?.join(", ") || ""}
                      onChange={(e) => {
                        const scale = e.target.value.split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                        setTokens(prev => ({
                          ...prev,
                          spacing: { ...prev.spacing!, scale }
                        }));
                      }}
                      placeholder="0, 1, 2, 4, 6, 8"
                    />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Validation Messages */}
        {validationResult && (
          <div className="space-y-2">
            {validationResult.valid ? (
              <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm font-medium">All validations passed</span>
              </div>
            ) : (
              <div className="space-y-2">
                {validationResult.errors.map((error, index) => (
                  <div key={index} className="flex items-start gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
                    <AlertCircle className="h-4 w-4 mt-0.5" />
                    <div className="text-sm">
                      <strong>{error.field}:</strong> {error.message}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {validationResult.warnings && validationResult.warnings.length > 0 && (
              <div className="space-y-2">
                {validationResult.warnings.map((warning, index) => (
                  <div key={index} className="flex items-start gap-2 text-yellow-600 bg-yellow-50 p-3 rounded-lg">
                    <AlertCircle className="h-4 w-4 mt-0.5" />
                    <div className="text-sm">
                      <strong>{warning.field}:</strong> {warning.message}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Preview Section */}
        {showPreview && validationResult?.valid && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Preview</h3>
            <DesignTokenPreview tokens={tokens as DesignTokens} />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleGeneratePreview}>
            <Upload className="h-4 w-4 mr-2" />
            Generate Preview
          </Button>
          <Button onClick={handleSave} disabled={!validationResult?.valid || isUploading}>
            {isUploading ? "Saving..." : "Save Design System"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
