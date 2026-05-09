import { google } from "googleapis";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  console.error("Missing Google credentials in .env.local");
  process.exit(1);
}

async function main() {
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  // Force a fresh access token
  const { token } = await auth.getAccessToken();
  console.log("\nAccess token obtained. Checking scopes...\n");

  const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
  const info = await res.json();
  console.log(JSON.stringify(info, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
