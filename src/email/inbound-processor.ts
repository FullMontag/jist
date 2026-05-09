/**
 * Inbound email processor.
 *
 * Called when a user forwards a bill/invoice to forward@velir.dev.
 * Flow:
 *   1. Fetch full email content from Resend API (webhook only carries metadata)
 *   2. Match sender to a user in the DB
 *   3. Run subscriptions + renewals analyzers on the single email
 *   4. Save results to Postgres
 *   5. Reply to the sender with a plain-text summary
 */

import { Resend } from "resend";
import { subscriptionsAnalyzer } from "@/analyzers/subscriptions";
import { renewalsAnalyzer } from "@/analyzers/renewals";
import { runAnalyzer } from "@/analyzers/types";
import { createProvider } from "@/llm";
import { saveAnalyzerResults, saveTransactions } from "@/db/results";
import { getAllUsersWithTokens } from "@/db/tokens";
import { fromSubscriptions, fromRenewals, deduplicateTransactions } from "@/pipeline";
import type { RawEmail } from "@/gmail/fetcher";
import type { SubscriptionOutput } from "@/analyzers/subscriptions";
import type { RenewalsOutput } from "@/analyzers/renewals";
import type { AnalyzerResult } from "@/analyzers/types";

// ── Resend API types for inbound email content ────────────────────────────────

interface ResendEmailContent {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  }

  const hasContent = results.some((r) => {
    if (r.analyzerId === "subscriptions") return ((r.output as SubscriptionOutput).subscriptions ?? []).length > 0;
    if (r.analyzerId === "renewals") return ((r.output as RenewalsOutput).renewals ?? []).length > 0;
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

export async function processInboundEmail(data: InboundEmailData): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = extractEmailAddress(data.from);

  console.log(`[email/inbound] Processing email from ${fromAddress}: "${data.subject}"`);

  // 1. Fetch full email content from Resend
  const contentRes = await fetch(`https://api.resend.com/emails/${data.email_id}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });

  if (!contentRes.ok) {
    throw new Error(
      `Failed to fetch email content for ${data.email_id}: HTTP ${contentRes.status}`
    );
  }

  const emailContent = (await contentRes.json()) as ResendEmailContent;
  const rawBody = emailContent.text
    ? emailContent.text
    : stripHtml(emailContent.html ?? "");

  if (!rawBody.trim()) {
    console.warn(`[email/inbound] Empty body for ${data.email_id} — skipping`);
    return;
  }

  // 2. Match sender to a registered user
  const users = await getAllUsersWithTokens();
  const user = users.find(
    (u) => u.email.toLowerCase() === fromAddress
  );

  if (!user) {
    console.warn(`[email/inbound] Sender ${fromAddress} is not a registered user — ignoring`);
    return;
  }

  // 3. Build a RawEmail from the fetched content
  const rawEmail: RawEmail = {
    id: data.email_id,
    threadId: data.email_id,
    subject: data.subject,
    from: data.from,
    to: data.to.join(", "),
    date: emailContent.created_at ?? new Date().toISOString(),
    snippet: rawBody.slice(0, 200),
    body: rawBody.slice(0, 6000), // generous limit for a single forwarded doc
    labelIds: [],
  };

  // 4. Run subscriptions + renewals analyzers (not opportunities — that's inbox-only)
  const provider = createProvider("anthropic");
  const allResults: AnalyzerResult[] = [];
  const allTransactions = [];

  const subsResult = await runAnalyzer(subscriptionsAnalyzer, [rawEmail], provider);
  if (subsResult) {
    allResults.push(subsResult as AnalyzerResult);
    allTransactions.push(...fromSubscriptions(subsResult.output as SubscriptionOutput));
  }

  const renewalsResult = await runAnalyzer(renewalsAnalyzer, [rawEmail], provider);
  if (renewalsResult) {
    allResults.push(renewalsResult as AnalyzerResult);
    allTransactions.push(...fromRenewals(renewalsResult.output as RenewalsOutput));
  }

  // 5. Persist
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

  // 6. Reply with a summary
  const fromEmail = process.env.DIGEST_FROM_EMAIL ?? "onboarding@resend.dev";
  const replySummary = buildReplySummary(allResults, data.subject);

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: fromAddress,
    subject: `Re: ${data.subject}`,
    text: replySummary,
  });

  if (error) {
    console.error(`[email/inbound] Failed to send reply to ${fromAddress}:`, error.message);
  } else {
    console.log(`[email/inbound] Reply sent to ${fromAddress} ✓`);
  }
}
