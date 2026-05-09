import { getDb } from "./client";

interface GmailTokenRow {
  id: string;
  user_id: string;
  email: string;
  access_token: string;
  refresh_token: string | null;
  expiry_date: number | null;
  created_at: string;
  updated_at: string;
}

export async function saveGmailTokens(
  userId: string,
  email: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  }
) {
  const sql = getDb();
  await sql`
    INSERT INTO gmail_tokens (user_id, email, access_token, refresh_token, expiry_date)
    VALUES (${userId}, ${email}, ${tokens.access_token!}, ${tokens.refresh_token ?? null}, ${tokens.expiry_date ?? null})
    ON CONFLICT (user_id) DO UPDATE SET
      email        = EXCLUDED.email,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expiry_date  = EXCLUDED.expiry_date,
      updated_at   = now()
  `;
}

export async function getGmailTokens(userId: string): Promise<GmailTokenRow | null> {
  const sql = getDb();
  const rows = await sql<GmailTokenRow[]>`
    SELECT * FROM gmail_tokens WHERE user_id = ${userId} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getAllUsersWithTokens(): Promise<{ user_id: string; email: string }[]> {
  const sql = getDb();
  return sql<{ user_id: string; email: string }[]>`
    SELECT user_id, email FROM gmail_tokens
  `;
}
