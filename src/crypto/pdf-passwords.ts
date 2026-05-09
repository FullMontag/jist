import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.PDF_PASSWORD_KEY;
  if (!hex) throw new Error("PDF_PASSWORD_KEY env var not set");
  return Buffer.from(hex, "hex");
}

// Returns "ivHex:authTagHex:ciphertextHex"
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

export function decrypt(encrypted: string): string {
  const [ivHex, tagHex, ctHex] = encrypted.split(":");
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivHex!, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex!, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex!, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
