/**
 * Register a WhatsApp number for a user.
 *
 * Usage:
 *   npx tsx scripts/add-whatsapp-number.ts <email> <whatsapp-number>
 *
 * Example:
 *   npx tsx scripts/add-whatsapp-number.ts nirmontag@gmail.com +972501234567
 *   (The "whatsapp:" prefix is added automatically)
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { getDb } from "@/db/client";

async function main() {
  const [, , email, phone] = process.argv;
  if (!email || !phone) {
    console.error("Usage: npx tsx scripts/add-whatsapp-number.ts <email> <phone>");
    process.exit(1);
  }

  const normalized = phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`;
  const sql = getDb();

  const res = await sql`
    UPDATE gmail_tokens
    SET whatsapp_number = ${normalized}
    WHERE email = ${email}
    RETURNING user_id, email
  `;

  if (res.length === 0) {
    console.error(`No user found for email: ${email}`);
    process.exit(1);
  }

  console.log(`✓ WhatsApp number ${normalized} registered for ${email}`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
