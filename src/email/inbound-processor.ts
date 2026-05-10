/**
 * Inbound email processor.
 *
 * Called when a user forwards a bill/invoice to forward@velir.dev.
 * Flow:
 *   1. Fetch full email content from Resend API (webhook only carries metadata)
 *   2. Fetch all attachments (images → vision, PDFs → Claude document blocks)
 *   3. Match sender to a user in the DB
 *   4. Run subscriptions + renewals analyzers on the single email
 *   5. Save results to Postgres
 *   6. Reply to the sender with a plain-text summary
 */

import { Resend } from "resend";
import { getDb } from "@/db/client";
import { subscriptionsAnalyzer } from "@/analyzers/subscriptions";
import { renewalsAnalyzer } from "@/analyzers/renewals";
import { creditCardAnalyzer } from "@/analyzers/credit-card";
import { runAnalyzerNoFilter } from "@/analyzers/types";
import { createProvider } from "@/llm";
import { saveAnalyzerResults, saveTransactions } from "@/db/results";
import { saveCreditCardTransactions } from "@/db/credit-card";
import { getAllUsersWithTokens } from "@/db/tokens";
import { getPdfPasswords } from "@/db/pdf-passwords";
import { addKnownServices } from "@/db/known-services";
import { fromSubscriptions, fromRenewals, deduplicateTransactions } from "@/pipeline";
import { isEncryptedPdf, extractPdfText } from "@/email/pdf-decrypt";
import type { RawEmail } from "@/gmail/fetcher";
import type { SubscriptionOutput } from "@/analyzers/subscriptions";
import type { RenewalsOutput } from "@/analyzers/renewals";
import type { CreditCardOutput } from "@/analyzers/credit-card";
import type { AnalyzerResult } from "@/analyzers/types";
import type { ImageContentBlock, DocumentContentBlock, MediaContentBlock } from "@/llm/types";

// ── Resend API types ──────────────────────────────────────────────────────────

interface ResendAttachmentMeta {
  id: string;
  filename: string;
  content_type: string;
}

interface ResendEmailContent {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  created_at: string;
  attachments?: ResendAttachmentMeta[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
]);

// Extract inline base64 images from HTML — covers WhatsApp photos forwarded
// via Gmail which arrive as data URIs rather than MIME attachments.
function extractInlineImages(html: string): ImageContentBlock[] {
  const images: ImageContentBlock[] = [];
  const re = /src="data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    images.push({
      type: "image",
      mediaType: match[1] as ImageContentBlock["mediaType"],
      data: match[2]!,
    });
  }
  return images;
}

async function fetchAttachments(
  emailId: string,
  attachments: ResendAttachmentMeta[],
  apiKey: string
): Promise<{ images: ImageContentBlock[]; pdfBuffers: Buffer[] }> {
  const images: ImageContentBlock[] = [];
  const pdfBuffers: Buffer[] = [];

  for (const att of attachments) {
    const isImage = SUPPORTED_IMAGE_TYPES.has(att.content_type);
    const isPdf = att.content_type === "application/pdf";
    if (!isImage && !isPdf) continue;

    try {
      const res = await fetch(
        `https://api.resend.com/emails/receiving/${emailId}/attachments/${att.id}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (!res.ok) {
        console.warn(`[email/inbound] Could not fetch attachment ${att.filename}: HTTP ${res.status}`);
        continue;
      }
      // The metadata endpoint returns JSON with a download_url — fetch that for actual bytes.
      const meta = await res.json() as Record<string, unknown>;
      const downloadUrl = meta.download_url as string | undefined;
      if (!downloadUrl) {
        console.warn(`[email/inbound] No download_url for attachment ${att.filename} — skipping`);
        continue;
      }

      const dlRes = await fetch(downloadUrl);
      if (!dlRes.ok) {
        console.warn(`[email/inbound] Could not download attachment ${att.filename}: HTTP ${dlRes.status}`);
        continue;
      }
      const buf = await dlRes.arrayBuffer();
      const data = Buffer.from(buf).toString("base64");

      if (isImage) {
        images.push({ type: "image", mediaType: att.content_type as ImageContentBlock["mediaType"], data });
        console.log(`[email/inbound] Loaded image attachment: ${att.filename}`);
      } else {
        pdfBuffers.push(Buffer.from(buf));
        console.log(`[email/inbound] Loaded PDF attachment: ${att.filename}`);
      }
    } catch (err) {
      console.warn(`[email/inbound] Failed to fetch attachment ${att.filename}:`, err);
    }
  }

  return { images, pdfBuffers };
}

function extractEmailAddress(header: string): string {
  // "Name <email@example.com>" → "email@example.com"
  const match = header.match(/<([^>]+)>/);
  return match ? match[1]!.trim().toLowerCase() : header.trim().toLowerCase();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, "\n")
    .trim();
}

function buildReplySummary(
  results: AnalyzerResult[],
  subject: string
): string {
  const lines: string[] = [
    `Got it — here's what I extracted from "${subject}":`,
    "",
  ];

  for (const result of results) {
    if (result.analyzerId === "subscriptions") {
      const out = result.output as SubscriptionOutput;
      const items = out.subscriptions ?? [];
      if (items.length > 0) {
        lines.push("Charges detected:");
        for (const s of items) {
          const curr = s.currency === "ILS" ? "₪" : s.currency === "USD" ? "$" : s.currency;
          lines.push(`  • ${s.service} — ${curr}${s.amount} (${s.date})`);
        }
        lines.push("");
      }
    }

    if (result.analyzerId === "renewals") {
      const out = result.output as RenewalsOutput;
      const items = out.renewals ?? [];
      if (items.length > 0) {
        lines.push("Upcoming renewals:");
        for (const r of items) {
          const curr = r.currency === "ILS" ? "₪" : r.currency === "USD" ? "$" : r.currency;
          const amt = r.amount != null ? ` — ${curr}${r.amount}` : "";
          lines.push(`  • ${r.service}${amt} (renews ${r.renewalDate})`);
        }
        lines.push("");
      }
    }

    if (result.analyzerId === "credit-card") {
      const out = result.output as CreditCardOutput;
      const items = out.transactions ?? [];
      if (items.length > 0) {
        lines.push(`Credit card transactions (card …${out.cardLast4}, ${out.statementMonth}):`);
        for (const t of items) {
          const curr = t.currency === "ILS" ? "₪" : t.currency === "USD" ? "$" : t.currency;
          lines.push(`  • ${t.merchant} — ${curr}${t.amount} (${t.date}) [${t.category}]`);
        }
        lines.push(`  Total: ₪${out.totalCharged}`);
        lines.push("");
      }
    }
  }

  const hasContent = results.some((r) => {
    if (r.analyzerId === "subscriptions") return ((r.output as SubscriptionOutput).subscriptions ?? []).length > 0;
    if (r.analyzerId === "renewals") return ((r.output as RenewalsOutput).renewals ?? []).length > 0;
    if (r.analyzerId === "credit-card") return ((r.output as CreditCardOutput).transactions ?? []).length > 0;
    return false;
  });

  if (!hasContent) {
    lines.push("No financial data could be extracted from this email.");
  }

  lines.push("— Jist");
  return lines.join("\n");
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface InboundEmailData {
  email_id: string;
  from: string;     // may include display name: "Nir <nir@example.com>"
  to: string[];
  subject: string;
}

async function sendReply(
  resend: Resend,
  to: string,
  subject: string,
  text: string
): Promise<void> {
  const from = process.env.DIGEST_FROM_EMAIL ?? "onboarding@resend.dev";
  const { error } = await resend.emails.send({ from, to, subject: `Re: ${subject}`, text });
  if (error) {
    console.error(`[email/inbound] Failed to send reply to ${to}:`, error.message);
  } else {
    console.log(`[email/inbound] Reply sent to ${to} ✓`);
  }
}

export async function processInboundEmail(data: InboundEmailData): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = extractEmailAddress(data.from);

  console.log(`[email/inbound] Processing email from ${fromAddress}: "${data.subject}"`);

  // 1. Fetch full email content from Resend
  const contentRes = await fetch(`https://api.resend.com/emails/receiving/${data.email_id}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });

  if (!contentRes.ok) {
    const body = await contentRes.text();
    throw new Error(
      `Failed to fetch email content for ${data.email_id}: HTTP ${contentRes.status} — ${body}`
    );
  }

  const emailContent = (await contentRes.json()) as ResendEmailContent;

  // Extract inline images BEFORE stripping HTML — WhatsApp photos forwarded via
  // Gmail arrive as data URIs embedded in the HTML body, not as MIME attachments.
  const inlineImages = emailContent.html ? extractInlineImages(emailContent.html) : [];
  if (inlineImages.length > 0) {
    console.log(`[email/inbound] Found ${inlineImages.length} inline image(s) in HTML body`);
  }

  const rawBody = emailContent.text
    ? emailContent.text
    : stripHtml(emailContent.html ?? "");

  // 2. Fetch all MIME attachments (images + PDFs) before deciding whether to proceed
  const apiKey = process.env.RESEND_API_KEY!;
  const { images: mimeImages, pdfBuffers } = emailContent.attachments?.length
    ? await fetchAttachments(data.email_id, emailContent.attachments, apiKey)
    : { images: [], pdfBuffers: [] };

  // Bail only if there is truly no content to analyze
  if (!rawBody.trim() && inlineImages.length === 0 && mimeImages.length === 0 && pdfBuffers.length === 0) {
    console.warn(`[email/inbound] Empty body and no attachments for ${data.email_id} — skipping`);
    return;
  }

  // 3. Match sender to a registered user
  const users = await getAllUsersWithTokens();
  const user = users.find(
    (u) => u.email.toLowerCase() === fromAddress
  );

  if (!user) {
    console.warn(`[email/inbound] Sender ${fromAddress} is not a registered user — ignoring`);
    return;
  }

  // 4. Resolve PDFs: encrypted ones are decrypted + text-extracted using stored passwords;
  //    unencrypted ones are passed as native Claude document blocks.
  let extraBodyText = "";
  const pdfDocBlocks: DocumentContentBlock[] = [];

  if (pdfBuffers.length > 0) {
    const passwords = await getPdfPasswords(user.user_id);
    for (const buf of pdfBuffers) {
      if (isEncryptedPdf(buf)) {
        const text = await extractPdfText(buf, passwords);
        if (text) {
          console.log(`[email/inbound] Decrypted PDF — extracted ${text.length} chars`);
          extraBodyText += "\n\n" + text;
        } else {
          console.warn(`[email/inbound] Encrypted PDF but no stored password worked — skipping`);
        }
      } else {
        pdfDocBlocks.push({ type: "document", mediaType: "application/pdf", data: buf.toString("base64") });
      }
    }
  }

  const allImages: MediaContentBlock[] = [...inlineImages, ...mimeImages, ...pdfDocBlocks];

  if (allImages.length > 0 || extraBodyText) {
    console.log(
      `[email/inbound] Content: ${inlineImages.length} inline image, ${mimeImages.length} image attachment, ` +
      `${pdfDocBlocks.length} PDF block, ${extraBodyText.length} chars from decrypted PDF(s)`
    );
  }

  // 5. Build a RawEmail from the fetched content
  const combinedBody = (rawBody + extraBodyText).slice(0, 8000);
  const rawEmail: RawEmail = {
    id: data.email_id,
    threadId: data.email_id,
    subject: data.subject,
    from: data.from,
    to: data.to.join(", "),
    date: emailContent.created_at ?? new Date().toISOString(),
    snippet: combinedBody.slice(0, 200),
    body: combinedBody,
    labelIds: [],
  };

  // 6. Run subscriptions + renewals analyzers (not opportunities — that's inbox-only)
  try {
    const provider = createProvider("anthropic");
    const allResults: AnalyzerResult[] = [];
    const allTransactions = [];

    // Run credit card analyzer first — if it finds a statement, skip
    // subscriptions/renewals (they produce wrong results on consolidated statements)
    const creditCardResult = await runAnalyzerNoFilter(creditCardAnalyzer, [rawEmail], provider, allImages);
    const isCreditCardStatement = creditCardResult != null &&
      ((creditCardResult.output as CreditCardOutput).transactions?.length ?? 0) > 0;

    if (isCreditCardStatement) {
      allResults.push(creditCardResult as AnalyzerResult);
      const ccOut = creditCardResult.output as CreditCardOutput;
      await saveCreditCardTransactions(user.user_id, ccOut.cardLast4, ccOut.statementMonth, ccOut.transactions);
      console.log(`[email/inbound] CC statement: ${ccOut.transactions.length} transactions, card …${ccOut.cardLast4}`);
    } else {
      // Not a CC statement — run subscriptions + renewals as normal
      const subsResult = await runAnalyzerNoFilter(subscriptionsAnalyzer, [rawEmail], provider, allImages);
      if (subsResult) {
        allResults.push(subsResult as AnalyzerResult);
        allTransactions.push(...fromSubscriptions(subsResult.output as SubscriptionOutput));
      }
      const renewalsResult = await runAnalyzerNoFilter(renewalsAnalyzer, [rawEmail], provider, allImages);
      if (renewalsResult) {
        allResults.push(renewalsResult as AnalyzerResult);
        allTransactions.push(...fromRenewals(renewalsResult.output as RenewalsOutput));
      }
    }

    // 7. Persist
    if (allResults.length > 0) {
      await saveAnalyzerResults(user.user_id, allResults);
    }

    const transactions = deduplicateTransactions(allTransactions);
    if (transactions.length > 0) {
      await saveTransactions(user.user_id, transactions);
    }

    console.log(
      `[email/inbound] Saved ${allResults.length} results, ${transactions.length} transactions for ${user.email}`
    );

    // 8. Learn new service names for future weekly sweeps
    const learnedServices = allResults.flatMap((r) => {
      if (r.analyzerId === "subscriptions")
        return ((r.output as SubscriptionOutput).subscriptions ?? []).map((s) => s.service);
      if (r.analyzerId === "renewals")
        return ((r.output as RenewalsOutput).renewals ?? []).map((s) => s.service);
      return [];
    });
    if (learnedServices.length > 0) {
      await addKnownServices(user.user_id, learnedServices);
      console.log(`[email/inbound] Learned ${learnedServices.length} service keyword(s) for future sweeps`);
    }

    // 9. Mark as successfully processed (idempotency — written at success so failed/timeout runs
    //    leave the email unblocked and retriable via the route handler's check)
    const sql = getDb();
    await sql`
      INSERT INTO processed_inbound_emails (email_id, user_id)
      VALUES (${data.email_id}, ${user.user_id})
      ON CONFLICT (email_id) DO NOTHING
    `;

    // 10. Reply with a summary
    await sendReply(resend, fromAddress, data.subject, buildReplySummary(allResults, data.subject));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email/inbound] Processing error:`, err);
    await sendReply(
      resend,
      fromAddress,
      data.subject,
      `Something went wrong while processing your forwarded email.\n\nError: ${message}\n\n— Jist`
    );
  }
}
