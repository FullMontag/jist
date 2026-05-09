import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export interface RawEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
  labelIds: string[];
  // Gmail attachment IDs for PDF parts (populated by fetchEmailsSince)
  pdfAttachmentIds?: string[];
}

function decodeBody(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
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
    .replace(/&#x27;/g, "'")
    .replace(/\s{2,}/g, "\n")
    .trim();
}

function extractPdfAttachmentIds(payload: gmail_v1.Schema$MessagePart): string[] {
  const ids: string[] = [];
  if (payload.mimeType === "application/pdf" && payload.body?.attachmentId) {
    ids.push(payload.body.attachmentId);
  }
  for (const part of payload.parts ?? []) {
    ids.push(...extractPdfAttachmentIds(part));
  }
  return ids;
}

function extractBody(payload: gmail_v1.Schema$MessagePart): string {
  // Prefer text/plain, fall back to text/html
  if (!payload) return "";

  if (payload.body?.data) {
    const decoded = decodeBody(payload.body.data);
    return payload.mimeType === "text/html" ? stripHtml(decoded) : decoded;
  }

  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeBody(plain.body.data);

    const html = payload.parts.find((p) => p.mimeType === "text/html");
    if (html?.body?.data) return stripHtml(decodeBody(html.body.data));

    // Recurse into multipart parts
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return "";
}

function getHeader(
  headers: { name?: string | null; value?: string | null }[],
  name: string
): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function fetchEmailsSince(
  auth: OAuth2Client,
  sinceDays = 7,
  maxResults = 200
): Promise<RawEmail[]> {
  const gmail = google.gmail({ version: "v1", auth });

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: `newer_than:${sinceDays}d -category:social -category:promotions`,
    maxResults,
  });

  const messages = listRes.data.messages ?? [];
  if (messages.length === 0) return [];

  const emails = await Promise.all(
    messages.map(async (msg) => {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "full",
      });

      const payload = full.data.payload!;
      const headers = payload.headers ?? [];

      return {
        id: full.data.id!,
        threadId: full.data.threadId!,
        subject: getHeader(headers, "subject"),
        from: getHeader(headers, "from"),
        to: getHeader(headers, "to"),
        date: getHeader(headers, "date"),
        snippet: full.data.snippet ?? "",
        body: extractBody(payload),
        labelIds: full.data.labelIds ?? [],
        pdfAttachmentIds: extractPdfAttachmentIds(payload),
      } satisfies RawEmail;
    })
  );

  return emails;
}
