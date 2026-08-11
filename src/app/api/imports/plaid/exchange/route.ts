import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { checkBankConnectRateLimit } from "@/lib/imports/rate-limit";
import { isPlaidConfigured, getPlaidClient } from "@/lib/imports/plaid-client";
import { createBankConnection } from "@/lib/imports/bank-connections";
import { logServerError } from "@/lib/observability/log-error";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

// Plaid Link's own onSuccess callback already hands the client the
// institution's display name in its metadata — no need for a second
// /institutions/get_by_id round trip just to label the connection.
const exchangeSchema = z.object({
  publicToken: z.string().min(1),
  institutionName: z.string().trim().max(200).nullable().optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isPlaidConfigured()) {
    return NextResponse.json(
      { error: "source_disabled", message: "Plaid import isn't available yet." },
      { status: 400 },
    );
  }

  const rateLimit = checkBankConnectRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many connection attempts recently. Try again in a bit." },
      { status: 429 },
    );
  }

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = exchangeSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", message: "Invalid request." }, { status: 400 });
  }

  try {
    const client = getPlaidClient();
    const response = await client.itemPublicTokenExchange({ public_token: parsed.data.publicToken });
    await createBankConnection({
      userId: session.user.id,
      provider: "plaid",
      providerItemId: response.data.item_id,
      institutionName: parsed.data.institutionName ?? null,
      accessToken: response.data.access_token,
    });
    return NextResponse.json({ connected: true });
  } catch (error) {
    logServerError("imports.plaid.exchange", error, { userId: session.user.id });
    return NextResponse.json(
      { error: "plaid_error", message: "Couldn't finish connecting your bank. Try again." },
      { status: 502 },
    );
  }
}
