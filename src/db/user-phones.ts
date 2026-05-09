import { getDb } from "./client";

export interface WhatsAppUser {
  user_id: string;
  email: string;
}

export async function getUserByWhatsAppNumber(
  phone: string
): Promise<WhatsAppUser | null> {
  const sql = getDb();
  // Accept both "whatsapp:+972..." and "+972..." formats
  const normalized = phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`;
  const rows = await sql<WhatsAppUser[]>`
    SELECT user_id, email FROM gmail_tokens
    WHERE whatsapp_number = ${normalized}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
