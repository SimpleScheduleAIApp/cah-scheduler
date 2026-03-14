"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

interface ValidationError {
  sheet: string;
  row: number;
  message: string;
}

interface ValidationWarning {
  sheet: string;
  row: number;
  message: string;
}

interface PreviewResult {
  success: boolean;
  preview?: {
    staff: number;
    units: number;
    holidays: number;
  };
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ImportResult {
  success: boolean;
  imported?: {
    staff: number;
    units: number;
    holidays: number;
  };
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  error?: string;
}

export default function SetupPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    window.location.href = "/api/import";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  }

  async function handleFileSelect(file: File) {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      alert("Please select an Excel file (.xlsx or .xls)");
      return;
    }
    setSelectedFile(file);
    setPreview(null);
    setResult(null);

    // Validate the file
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("validateOnly", "true");

      const res = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setPreview(data);
    } catch (error) {
      console.error("Validation error:", error);
      setPreview({
        success: false,
        errors: [{ sheet: "File", row: 0, message: "Failed to read file" }],
        warnings: [],
      });
    } finally {
      setUploading(false);
    }
  }

  function handleConfirmImport() {
    setConfirmDialogOpen(true);
  }

  async function executeImport() {
    setConfirmDialogOpen(false);
    if (!selectedFile) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setResult(data);
      if (data.success) {
        setPreview(null);
        setSelectedFile(null);
      }
    } catch (error) {
      console.error("Import error:", error);
      setResult({
        success: false,
        error: "Failed to import data. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  }

  function resetForm() {
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Setup / Import Data</h1>
        <p className="mt-1 text-muted-foreground">
          Import your hospital data from an Excel file
        </p>
      </div>

      {/* Template Download */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Step 1: Download Template</CardTitle>
          <CardDescription>
            Download the Excel template and fill it with your hospital data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={downloadTemplate} variant="outline">
            Download Template (.xlsx)
          </Button>
          <p className="mt-3 text-sm text-muted-foreground">
            The template contains 5 sheets: <strong>Staff</strong>, <strong>Units</strong>, <strong>Holidays</strong>, <strong>Census Bands</strong>, and <strong>Staff Leave</strong>
          </p>
        </CardContent>
      </Card>

      {/* File Upload */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Step 2: Upload Your Data</CardTitle>
          <CardDescription>
            Upload your filled Excel file to import data
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              accept=".xlsx,.xls"
              className="hidden"
            />
            {selectedFile ? (
              <div>
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetForm}
                  className="mt-2"
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div>
                <p className="text-muted-foreground mb-2">
                  Drag and drop your Excel file here, or
                </p>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Browse Files
                </Button>
              </div>
            )}
          </div>

          {/* Warning */}
          <Alert className="mt-4" variant="destructive">
            <AlertTitle>Warning: Data Reset</AlertTitle>
            <AlertDescription>
              Importing will delete ALL existing data (staff, schedules, assignments, etc.)
              and replace it with the data from your Excel file.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Preview / Validation Results */}
      {uploading && (
        <Card className="mb-6">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Processing file...</p>
          </CardContent>
        </Card>
      )}

      {preview && !uploading && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Step 3: Review & Import</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Counts */}
            {preview.preview && (
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-muted rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold">{preview.preview.staff}</p>
                  <p className="text-sm text-muted-foreground">Staff</p>
                </div>
                <div className="bg-muted rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold">{preview.preview.units}</p>
                  <p className="text-sm text-muted-foreground">Units</p>
                </div>
                <div className="bg-muted rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold">{preview.preview.holidays}</p>
                  <p className="text-sm text-muted-foreground">Holidays</p>
                </div>
              </div>
            )}

            {/* Errors */}
            {preview.errors.length > 0 && (
              <div className="mb-4">
                <h4 className="font-medium text-red-600 mb-2">
                  Errors ({preview.errors.length})
                </h4>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                  {preview.errors.map((error, i) => (
                    <div key={i} className="text-sm text-red-700 mb-1">
                      <Badge variant="outline" className="mr-2">
                        {error.sheet} {error.row > 0 && `Row ${error.row}`}
                      </Badge>
                      {error.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {preview.warnings.length > 0 && (
              <div className="mb-4">
                <h4 className="font-medium text-yellow-600 mb-2">
                  Warnings ({preview.warnings.length})
                </h4>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                  {preview.warnings.map((warning, i) => (
                    <div key={i} className="text-sm text-yellow-700 mb-1">
                      <Badge variant="outline" className="mr-2">
                        {warning.sheet} {warning.row > 0 && `Row ${warning.row}`}
                      </Badge>
                      {warning.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleConfirmImport}
                disabled={preview.errors.length > 0 || uploading}
              >
                Import Data
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>

            {preview.errors.length > 0 && (
              <p className="mt-2 text-sm text-red-600">
                Please fix the errors above before importing
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Import Result */}
      {result && (
        <Card className="mb-6">
          <CardContent className="py-6">
            {result.success ? (
              <div className="text-center">
                <div className="text-4xl mb-2">✓</div>
                <h3 className="text-lg font-semibold text-green-600 mb-2">
                  Import Successful!
                </h3>
                <p className="text-muted-foreground mb-1">
                  Imported {result.imported?.staff} staff, {result.imported?.units} units, and {result.imported?.holidays} holidays.
                </p>
                <p className="text-sm text-muted-foreground mb-6">
                  Ready to build your first schedule?
                </p>
                <div className="flex flex-col items-center gap-2">
                  <Button onClick={() => window.location.href = "/schedule"}>
                    Create Your First Schedule →
                  </Button>
                  <div className="flex gap-3 mt-1">
                    <Button variant="outline" onClick={() => window.location.href = "/staff"}>
                      Review Staff
                    </Button>
                    <Button variant="ghost" onClick={resetForm}>
                      Import Another File
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-4xl mb-2">✗</div>
                <h3 className="text-lg font-semibold text-red-600 mb-2">
                  Import Failed
                </h3>
                <p className="text-muted-foreground mb-4">
                  {result.error || "An error occurred during import"}
                </p>
                <Button variant="outline" onClick={resetForm}>
                  Try Again
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Import</DialogTitle>
            <DialogDescription>
              This will permanently delete ALL existing data including:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 my-4">
            <li>All staff members and their preferences</li>
            <li>All schedules and assignments</li>
            <li>All leave requests and swap requests</li>
            <li>All callouts and coverage requests</li>
            <li>All units, holidays, and rules</li>
          </ul>
          <p className="text-sm font-medium">
            Are you sure you want to continue?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={executeImport}>
              Yes, Delete and Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
