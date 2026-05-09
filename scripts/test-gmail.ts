import { google } from "googleapis";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  console.error("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN in .env.local");
  process.exit(1);
}

async function main() {
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  const gmail = google.gmail({ version: "v1", auth });

  const listRes = await gmail.users.messages.list({ userId: "me", maxResults: 5 });
  const messages = listRes.data.messages ?? [];

  console.log(`\nFetched ${messages.length} messages:\n`);

  for (const msg of messages) {
    const full = await gmail.users.messages.get({ userId: "me", id: msg.id!, format: "metadata", metadataHeaders: ["Subject"] });
    const subject = full.data.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "(no subject)";
    console.log(`  • ${subject}`);
  }

  console.log("\nGmail connection works.\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
