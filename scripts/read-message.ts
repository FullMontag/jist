import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { google } from "googleapis";

async function main() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const gmail = google.gmail({ version: "v1", auth });
  const msg = await gmail.users.messages.get({ userId: "me", id: "19ceca484a4407a0", format: "full" });
  const payload = msg.data.payload!;
  const headers = payload.headers ?? [];
  const get = (name: string) => headers.find(h => h.name?.toLowerCase() === name)?.value ?? "";

  console.log(`Subject: ${get("subject")}`);
  console.log(`From:    ${get("from")}`);
  console.log(`Date:    ${get("date")}`);
  console.log(`Labels:  ${msg.data.labelIds?.join(", ")}`);

  // Apply the same HTML stripping the fetcher now uses
  function decodeB64(data: string) { return Buffer.from(data, "base64url").toString("utf-8"); }
  function stripHtml(html: string) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\s{2,}/g, "\n").trim();
  }

  function extractPart(part: typeof payload): string {
    if (part.body?.data) {
      const decoded = decodeB64(part.body.data);
      return part.mimeType === "text/html" ? stripHtml(decoded) : decoded;
    }
    for (const p of part.parts ?? []) {
      if (p.mimeType === "text/plain" && p.body?.data) return decodeB64(p.body.data);
    }
    for (const p of part.parts ?? []) {
      if (p.mimeType === "text/html" && p.body?.data) return stripHtml(decodeB64(p.body.data));
    }
    return "";
  }

  const body = extractPart(payload);
  console.log(`\n--- Body as seen by analyzers (${body.length} chars) ---\n`);
  console.log(body.slice(0, 3000));
}

main().catch((err) => { console.error(err); process.exit(1); });
