import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { saveGmailTokens } from "@/db/tokens";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function createOAuthClient(): OAuth2Client {
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${baseUrl}/api/auth/gmail/callback`
  );
}

export function getAuthUrl(): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // force refresh_token every time
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/**
 * Creates an authenticated OAuth2 client for a given user.
 * If userId is provided, any token refresh is automatically persisted back to
 * the DB so the next run starts with a valid access token.
 */
export function createAuthenticatedClient(
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  },
  userId?: string
): OAuth2Client {
  const client = createOAuthClient();
  client.setCredentials(tokens);

  // Persist refreshed tokens back to DB so we don't burn a refresh on every run.
  if (userId) {
    client.on("tokens", (newTokens) => {
      saveGmailTokens(userId, userId, {
        access_token: newTokens.access_token ?? tokens.access_token,
        refresh_token: newTokens.refresh_token ?? tokens.refresh_token,
        expiry_date: newTokens.expiry_date ?? tokens.expiry_date,
      }).catch((err) =>
        console.error(`[oauth] Failed to persist refreshed tokens for ${userId}:`, err)
      );
    });
  }

  return client;
}
