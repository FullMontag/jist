/**
 * Enriches RawEmails that have PDF attachments by fetching the attachment
 * bytes from the Gmail API, decrypting if needed, and appending extracted
 * text to the email body — so the weekly digest analyzers can read them.
 *
 * Only processes emails where the body is short (< 300 chars), which is the
 * tell-tale sign that the main content is in an attachment rather than the body.
 */

import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { RawEmail } from "./fetcher";
import { isEncryptedPdf, extractPdfText } from "@/email/pdf-decrypt";
import { getPdfPasswords } from "@/db/pdf-passwords";

const BODY_SHORT_THRESHOLD = 300;

export async function enrichEmailsWithPdfText(
  auth: OAuth2Client,
  userId: string,
  emails: RawEmail[]
): Promise<RawEmail[]> {
  const candidates = emails.filter(
    (e) => e.pdfAttachmentIds?.length && e.body.length < BODY_SHORT_THRESHOLD
  );
  if (candidates.length === 0) return emails;

  const gmail = google.gmail({ version: "v1", auth });
  const passwords = await getPdfPasswords(userId);

  const enriched = new Map<string, string>(); // email id → extra text

  for (const email of candidates) {
    const texts: string[] = [];
    for (const attId of email.pdfAttachmentIds!) {
      try {
        const res = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: email.id,
          id: attId,
        });
        if (!res.data.data) continue;
        const buf = Buffer.from(res.data.data, "base64url");

        if (isEncryptedPdf(buf)) {
          const text = await extractPdfText(buf, passwords);
          if (text) {
            console.log(`[gmail/attachments] Decrypted PDF in email ${email.id} (${text.length} chars)`);
            texts.push(text);
          } else {
            console.warn(`[gmail/attachments] Encrypted PDF in email ${email.id} — no matching password`);
          }
        } else {
          const text = await extractPdfText(buf, [""]);
          if (text) {
            console.log(`[gmail/attachments] Extracted PDF text in email ${email.id} (${text.length} chars)`);
            texts.push(text);
          }
        }
      } catch (err) {
        console.warn(`[gmail/attachments] Failed to process attachment ${attId}:`, err);
      }
    }
    if (texts.length > 0) enriched.set(email.id, texts.join("\n\n"));
  }

  return emails.map((e) => {
    const extra = enriched.get(e.id);
    if (!extra) return e;
    return { ...e, body: (e.body + "\n\n" + extra).slice(0, 8000) };
  });
}
