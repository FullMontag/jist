/**
 * One-time script to obtain a Google OAuth refresh token.
 * Uses the loopback redirect (http://127.0.0.1) supported by Desktop app OAuth clients.
 *
 * Usage:
 *   npx tsx scripts/get-refresh-token.ts
 */

import http from "http";
import { google } from "googleapis";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 3000;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env.local");
  process.exit(1);
}

const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

const parsedUrl = new URL(authUrl);
console.log("\nScopes being requested:", parsedUrl.searchParams.get("scope"));
console.log("\nOpen this URL in your browser and approve Gmail access:\n");
console.log(authUrl);
console.log(`\nWaiting for callback on ${REDIRECT_URI}...\n`);

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url ?? "/", REDIRECT_URI).searchParams.get("code");

  if (!code) {
    res.writeHead(400);
    res.end("Missing code — something went wrong.");
    return;
  }

  try {
    const { tokens } = await client.getToken(code);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Done! You can close this tab and check your terminal.</h2>");

    console.log("=".repeat(60));
    console.log("Scopes granted:", tokens.scope);
    console.log("=".repeat(60));
    console.log("Add this to your .env.local:");
    console.log("=".repeat(60));
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("=".repeat(60) + "\n");

    if (!tokens.refresh_token) {
      console.warn(
        "No refresh_token returned. Revoke access at:\n" +
        "https://myaccount.google.com/permissions\n" +
        "Then run this script again.\n"
      );
    }
  } catch (err) {
    res.writeHead(500);
    res.end("Token exchange failed — check your terminal.");
    console.error("Token exchange error:", err);
  } finally {
    server.close();
  }
});

server.listen(PORT, "127.0.0.1");
