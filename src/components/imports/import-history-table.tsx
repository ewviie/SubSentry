import { History } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { ImportHistorySummary } from "@/lib/imports/history";

export function ImportHistoryTable({ imports }: { imports: ImportHistorySummary[] }) {
  if (imports.length === 0) {
    return (
      <EmptyState
        className="mt-6"
        icon={History}
        title="No imports yet"
        description="Once you import subscriptions from a connected bank account, bank CSV, Apple, or Google Play export, they'll show up here."
      />
    );
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Detected</TableHead>
            <TableHead>Confirmed</TableHead>
            <TableHead>Rejected</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {imports.map((record) => (
            <TableRow key={record.id}>
              <TableCell className="font-medium">{record.sourceLabel}</TableCell>
              <TableCell className="text-muted-foreground">
                <time dateTime={record.createdAtIso}>{record.createdAtLabel}</time>
              </TableCell>
              <TableCell className="font-mono tabular-nums">{record.detectedCount}</TableCell>
              <TableCell className="font-mono tabular-nums">{record.importedCount}</TableCell>
              <TableCell className="font-mono tabular-nums">{record.ignoredCount}</TableCell>
              <TableCell>
                <Badge variant={record.statusVariant}>{record.statusLabel}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
