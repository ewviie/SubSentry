"use client";

import { useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".csv"];

export function FileUploadStep({
  onFileSelected,
  error,
}: {
  onFileSelected: (file: File) => void;
  error: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function validateAndSelect(file: File) {
    setLocalError(null);
    const nameLower = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => nameLower.endsWith(ext))) {
      setLocalError("Please choose a .csv file.");
      return;
    }
    if (file.size === 0) {
      setLocalError("That file is empty.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setLocalError("That file is too large. Max size is 5MB.");
      return;
    }
    onFileSelected(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) validateAndSelect(file);
  }

  return (
    <div className="space-y-3">
      {/* A <label> wrapping a visually-hidden file input, not a div with a
          click handler — the whole area is natively clickable and keyboard
          accessible (Tab focuses the input, Enter/Space opens the file
          picker) without needing role="button" or a nested interactive
          control, which a separate "Choose file" button inside a clickable
          div would have been. */}
      <label
        htmlFor="import-file-input"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center transition-colors",
          dragOver ? "border-ring bg-muted" : "border-border hover:bg-muted/50",
        )}
      >
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Upload className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">Drop your CSV file here, or click to browse</p>
          <p className="text-sm text-muted-foreground">CSV files up to 5MB.</p>
        </div>
        <input
          id="import-file-input"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) validateAndSelect(file);
            e.target.value = "";
          }}
        />
      </label>
      {localError || error ? (
        <p role="alert" className="text-sm text-destructive">
          {localError ?? error}
        </p>
      ) : null}
    </div>
  );
}
