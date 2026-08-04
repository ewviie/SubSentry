import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listImports } from "@/lib/imports/queries";
import { summarizeImports } from "@/lib/imports/history";
import { ImportHistoryTable } from "@/components/imports/import-history-table";

export default async function ImportHistoryPage() {
  const user = await requireUser();
  const records = await listImports(user.id);
  const summaries = summarizeImports(records);

  return (
    <div className="max-w-4xl">
      <Link
        href="/subscriptions/import"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to import
      </Link>
      <h1 className="font-heading text-h1 font-semibold">Import history</h1>
      <p className="mt-1 text-muted-foreground">Every batch you&apos;ve reviewed and confirmed through the Import Center.</p>
      <ImportHistoryTable imports={summaries} />
    </div>
  );
}
