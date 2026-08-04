import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import "@/lib/imports/registry";
import { getImportProvider, IMPORT_SOURCE_IDS, type ImportSourceId } from "@/lib/imports/provider";
import { checkImportAnalyzeRateLimit } from "@/lib/imports/rate-limit";
import { analyzeParsedTransactions } from "@/lib/imports/analyze";
import { listSubscriptions } from "@/lib/subscriptions/queries";

const sourceSchema = z.enum(IMPORT_SOURCE_IDS);

// Never writes to the DB — same "return drafts, don't persist" contract
// /api/subscriptions/quick-add already establishes. Nothing about the
// uploaded file is ever stored: it's read into memory, processed, and
// discarded the moment this function returns.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkImportAnalyzeRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many imports analyzed recently. Try again in a bit." },
      { status: 429 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Couldn't read the upload." }, { status: 400 });
  }

  const sourceParsed = sourceSchema.safeParse(formData.get("source"));
  if (!sourceParsed.success) {
    return NextResponse.json({ error: "invalid_request", message: "Unknown import source." }, { status: 400 });
  }
  const source: ImportSourceId = sourceParsed.data;

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_request", message: "No file uploaded." }, { status: 400 });
  }

  const provider = getImportProvider(source);
  if (!provider.enabled) {
    return NextResponse.json(
      { error: "source_disabled", message: `${provider.label} import isn't available yet.` },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "invalid_request", message: "The uploaded file is empty." }, { status: 400 });
  }
  if (file.size > provider.maxFileSizeBytes) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `File is too large. Max size is ${Math.round(provider.maxFileSizeBytes / (1024 * 1024))}MB.`,
      },
      { status: 400 },
    );
  }

  const nameLower = file.name.toLowerCase();
  const typeMatches = provider.acceptedFileTypes.some(
    (accepted) => nameLower.endsWith(accepted) || file.type === accepted,
  );
  if (!typeMatches) {
    return NextResponse.json(
      { error: "invalid_file_type", message: `Unsupported file type. Expected ${provider.acceptedFileTypes.join(" or ")}.` },
      { status: 400 },
    );
  }

  let fileText: string;
  try {
    fileText = await file.text();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Couldn't read the file contents." }, { status: 400 });
  }

  const validation = provider.validate(fileText);
  if (!validation.valid) {
    return NextResponse.json({ error: "invalid_file_type", message: validation.reason }, { status: 400 });
  }

  let parseResult;
  try {
    parseResult = await provider.parse(fileText);
  } catch {
    return NextResponse.json(
      { error: "parse_failed", message: "Couldn't parse that file. Check the format and try again." },
      { status: 422 },
    );
  }

  const existingSubscriptions = await listSubscriptions(session.user.id);
  const { detected, warnings, skippedRowCount } = analyzeParsedTransactions(parseResult, existingSubscriptions);

  return NextResponse.json({ detected, warnings, skippedRowCount });
}
