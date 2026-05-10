/**
 * POST /api/email/inbound
 *
 * Resend inbound email webhook — fires when an email arrives at forward@velir.dev.
 * Verifies the Svix signature, then hands off to processInboundEmail() asynchronously
 * so Resend gets a 200 immediately (no retry storms if processing is slow).
 *
 * Setup checklist:
 *   1. Verify velir.dev in Resend dashboard → Domains
 *   2. Add inbound route: forward@velir.dev → https://jist-ashen.vercel.app/api/email/inbound
 *   3. Copy the webhook signing secret from Resend → add as RESEND_WEBHOOK_SECRET in Vercel
 */

import { NextRequest, NextResponse, after } from "next/server";
import { Webhook } from "svix";
import { processInboundEmail, type InboundEmailData } from "@/email/inbound-processor";
import { getDb } from "@/db/client";

interface ResendInboundPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    message_id: string;
    created_at: string;
    attachments: { filename: string; content_type: string }[];
  };
}

export async function POST(request: NextRequest) {
  // Must read the raw body before any parsing — signature verification is
  // sensitive to whitespace changes introduced by JSON.parse + re-stringify.
  const rawBody = await request.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[email/inbound] RESEND_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  // Verify Svix signature
  const svixId        = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing Svix signature headers" },
      { status: 400 }
    );
  }

  let payload: ResendInboundPayload;
  try {
    const wh = new Webhook(secret);
    payload = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendInboundPayload;
  } catch (err) {
    console.warn("[email/inbound] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Only handle inbound emails
  if (payload.type !== "email.received") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const emailData: InboundEmailData = {
    email_id: payload.data.email_id,
    from:     payload.data.from,
    to:       payload.data.to,
    subject:  payload.data.subject,
  };

  console.log(
    `[email/inbound] Received email from ${emailData.from}: "${emailData.subject}"`
  );

  // Idempotency: check if already processed before queuing background work.
  // We write the record at the END of successful processing (in processInboundEmail),
  // so a timeout/crash leaves the email unblocked for the next webhook retry.
  const sql = getDb();
  const existing = await sql<{ email_id: string }[]>`
    SELECT email_id FROM processed_inbound_emails WHERE email_id = ${emailData.email_id}
  `;
  if (existing.length > 0) {
    console.log(`[email/inbound] Already processed ${emailData.email_id} — skipping duplicate webhook`);
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Use after() so Resend gets a 200 immediately. Processing (PDF download + Claude call)
  // can take 30-90s for large scanned PDFs — well beyond Resend's 30s webhook timeout.
  after(async () => {
    try {
      await processInboundEmail(emailData);
    } catch (err) {
      console.error("[email/inbound] Background processing error:", err);
    }
  });

  return NextResponse.json({ ok: true });
}
