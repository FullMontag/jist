import { getDb } from "./client";
import { encrypt, decrypt } from "@/crypto/pdf-passwords";

export async function addPdfPassword(
  userId: string,
  service: string,
  password: string
): Promise<void> {
  const sql = getDb();
  const enc = encrypt(password);
  await sql`
    insert into pdf_passwords (user_id, service, password_enc)
    values (${userId}, ${service}, ${enc})
    on conflict (user_id, service) do update
      set password_enc = ${enc}, updated_at = now()
  `;
}

export async function getPdfPasswords(userId: string): Promise<string[]> {
  const sql = getDb();
  const rows = await sql<{ password_enc: string }[]>`
    select password_enc from pdf_passwords where user_id = ${userId}
  `;
  return rows.map((r) => decrypt(r.password_enc));
}
