/**
 * WhatsApp message processor.
 *
 * Routes incoming Twilio WhatsApp messages to either:
 *   - Extraction pipeline (media: photos, PDFs → financial data → reply)
 *   - Q&A (text → answer about their financial data)
 */

import { subscriptionsAnalyzer } from "@/analyzers/subscriptions";
import { renewalsAnalyzer } from "@/analyzers/renewals";
import { creditCardAnalyzer } from "@/analyzers/credit-card";
import { runAnalyzerNoFilter } from "@/analyzers/types";
import { createProvider } from "@/llm";
import { saveAnalyzerResults, saveTransactions } from "@/db/results";
import { saveCreditCardTransactions } from "@/db/credit-card";
import { addKnownServices } from "@/db/known-services";
import { getPdfPasswords } from "@/db/pdf-passwords";
import { isEncryptedPdf, extractPdfText } from "@/email/pdf-decrypt";
import { fromSubscriptions, fromRenewals, deduplicateTransactions } from "@/pipeline";
import { answerQuestion } from "./qa";
import type { SubscriptionOutput } from "@/analyzers/subscriptions";
import type { RenewalsOutput } from "@/analyzers/renewals";
import type { CreditCardOutput } from "@/analyzers/credit-card";
import type { AnalyzerResult } from "@/analyzers/types";
import type { ImageContentBlock, DocumentContentBlock, MediaContentBlock } from "@/llm/types";
import type { RawEmail } from "@/gmail/fetcher";

export interface WhatsAppMessage {
  from: string;           // "whatsapp:+972..."
  body: string;
  mediaItems: Array<{ url: string; contentType: string }>;
}

async function downloadMedia(
  url: string,
  contentType: string
): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString("base64")}`,
    },
  });
  if (!res.ok) throw new Error(`Failed to download media: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function buildMediaBlocks(
  mediaItems: WhatsAppMessage["mediaItems"],
  passwords: string[]
): Promise<{ blocks: MediaContentBlock[]; extractedText: string }> {
  const blocks: MediaContentBlock[] = [];
  let extractedText = "";

  for (const { url, contentType } of mediaItems) {
    try {
      const buf = await downloadMedia(url, contentType);

      if (contentType.startsWith("image/")) {
        const mediaType = contentType as ImageContentBlock["mediaType"];
        if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)) {
          blocks.push({ type: "image", mediaType, data: buf.toString("base64") });
        }
      } else if (contentType === "application/pdf") {
        if (isEncryptedPdf(buf)) {
          const text = await extractPdfText(buf, passwords);
          if (text) {
            console.log(`[whatsapp] Decrypted PDF — extracted ${text.length} chars`);
            extractedText += "\n\n" + text;
          } else {
            console.warn("[whatsapp] Encrypted PDF but no stored password matched");
            extractedText += "\n\n[Encrypted PDF — no matching password stored]";
          }
        } else {
          blocks.push({ type: "document", mediaType: "application/pdf", data: buf.toString("base64") });
        }
      }
    } catch (err) {
      console.warn(`[whatsapp] Failed to process media ${url}:`, err);
    }
  }

  return { blocks, extractedText };
}

export async function processWhatsAppMessage(
  userId: string,
  msg: WhatsAppMessage
): Promise<string> {
  const hasMedia = msg.mediaItems.length > 0;

  // ── Text-only → Q&A ───────────────────────────────────────────────────────
  if (!hasMedia) {
    const question = msg.body.trim();
    if (!question) return "Send me a question about your finances, or forward a receipt or invoice.";
    console.log(`[whatsapp] Q&A: "${question.slice(0, 80)}"`);
    return answerQuestion(userId, question);
  }

  // ── Media → extraction pipeline ───────────────────────────────────────────
  console.log(`[whatsapp] Processing ${msg.mediaItems.length} media item(s)`);

  const passwords = await getPdfPasswords(userId);
  const { blocks, extractedText } = await buildMediaBlocks(msg.mediaItems, passwords);

  const bodyText = (msg.body + extractedText).slice(0, 8000);

  if (!bodyText.trim() && blocks.length === 0) {
    return "I couldn't read that file. Try sending a clearer photo or a non-password-protected PDF (or store the password with me first).";
  }

  const rawEmail: RawEmail = {
    id: `wa-${Date.now()}`,
    threadId: `wa-${msg.from}`,
    subject: msg.body.slice(0, 100) || "WhatsApp media",
    from: msg.from,
    to: process.env.TWILIO_WHATSAPP_NUMBER ?? "",
    date: new Date().toISOString(),
    snippet: bodyText.slice(0, 200),
    body: bodyText,
    labelIds: [],
  };

  const provider = createProvider("anthropic");
  const allResults: AnalyzerResult[] = [];
  const allTransactions = [];

  const subsResult = await runAnalyzerNoFilter(subscriptionsAnalyzer, [rawEmail], provider, blocks as MediaContentBlock[]);
  if (subsResult) {
    allResults.push(subsResult as AnalyzerResult);
    allTransactions.push(...fromSubscriptions(subsResult.output as SubscriptionOutput));
  }

  const renewalsResult = await runAnalyzerNoFilter(renewalsAnalyzer, [rawEmail], provider, blocks as MediaContentBlock[]);
  if (renewalsResult) {
    allResults.push(renewalsResult as AnalyzerResult);
    allTransactions.push(...fromRenewals(renewalsResult.output as RenewalsOutput));
  }

  const creditCardResult = await runAnalyzerNoFilter(creditCardAnalyzer, [rawEmail], provider, blocks as MediaContentBlock[]);
  if (creditCardResult) {
    allResults.push(creditCardResult as AnalyzerResult);
    const ccOut = creditCardResult.output as CreditCardOutput;
    if (ccOut.transactions.length > 0) {
      await saveCreditCardTransactions(
        userId,
        ccOut.cardLast4,
        ccOut.statementMonth,
        ccOut.transactions
      );
      console.log(
        `[whatsapp] Saved ${ccOut.transactions.length} credit card transaction(s) (card …${ccOut.cardLast4}, ${ccOut.statementMonth})`
      );
    }
  }

  if (allResults.length > 0) await saveAnalyzerResults(userId, allResults);

  const transactions = deduplicateTransactions(allTransactions);
  if (transactions.length > 0) await saveTransactions(userId, transactions);

  // Learn service names for future weekly sweeps
  const learnedServices = allResults.flatMap((r) => {
    if (r.analyzerId === "subscriptions")
      return ((r.output as SubscriptionOutput).subscriptions ?? []).map((s) => s.service);
    if (r.analyzerId === "renewals")
      return ((r.output as RenewalsOutput).renewals ?? []).map((s) => s.service);
    return [];
  });
  if (learnedServices.length > 0) await addKnownServices(userId, learnedServices);

  // Build reply
  const lines: string[] = [];
  for (const r of allResults) {
    if (r.analyzerId === "subscriptions") {
      const items = (r.output as SubscriptionOutput).subscriptions ?? [];
      for (const s of items) {
        const sym = s.currency === "ILS" ? "₪" : s.currency === "USD" ? "$" : s.currency;
        lines.push(`${s.service} — ${sym}${s.amount} (${s.date})`);
      }
    }
    if (r.analyzerId === "renewals") {
      const items = (r.output as RenewalsOutput).renewals ?? [];
      for (const r of items) {
        const sym = r.currency === "ILS" ? "₪" : r.currency === "USD" ? "$" : r.currency;
        const amt = r.amount != null ? ` — ${sym}${r.amount}` : "";
        lines.push(`Renews ${r.renewalDate}: ${r.service}${amt}`);
      }
    }
    if (r.analyzerId === "credit-card") {
      const ccOut = r.output as CreditCardOutput;
      const items = ccOut.transactions ?? [];
      if (items.length > 0) {
        lines.push(`Credit card …${ccOut.cardLast4} (${ccOut.statementMonth}) — ${items.length} transactions, total ₪${ccOut.totalCharged}:`);
        for (const t of items) {
          const sym = t.currency === "ILS" ? "₪" : t.currency === "USD" ? "$" : t.currency;
          lines.push(`  ${t.date} ${t.merchant} ${sym}${t.amount} [${t.category}]`);
        }
      }
    }
  }

  if (lines.length === 0) return "Got it, but I couldn't find any financial data in that file.";
  return "Got it:\n" + lines.join("\n");
}
