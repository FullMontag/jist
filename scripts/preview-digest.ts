/**
 * Renders the digest for the current user and saves it to /tmp/digest-preview.html.
 *
 * Usage: npx tsx scripts/preview-digest.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { google } from "googleapis";
import { renderDigest } from "@/email/renderer";

async function main() {
  // Resolve the user's email from Google so we query the right Supabase rows
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const oauth2 = google.oauth2({ version: "v2", auth });
  const { data: me } = await oauth2.userinfo.get();
  const userId = me.email!;

  console.log(`Rendering digest for ${userId}...`);
  const html = await renderDigest(userId);

  const outPath = "/tmp/digest-preview.html";
  writeFileSync(outPath, html, "utf-8");
  console.log(`Saved → ${outPath}`);
  console.log("Open it in a browser: file:///tmp/digest-preview.html");
}

main().catch((err) => { console.error(err); process.exit(1); });
