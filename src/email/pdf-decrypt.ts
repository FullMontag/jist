/**
 * PDF utilities for the inbound email processor.
 *
 * Uses unpdf (built for serverless, no worker setup required) for decryption
 * and text extraction. isEncryptedPdf is a zero-dep byte check.
 */

// Encrypted PDFs always contain an /Encrypt entry — check the bytes directly.
export function isEncryptedPdf(data: Buffer): boolean {
  return data.includes(Buffer.from("/Encrypt"));
}

// Returns extracted text, or null if none of the passwords worked.
export async function extractPdfText(
  data: Buffer,
  passwords: string[]
): Promise<string | null> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  for (const password of passwords) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(data), { password });
      const { text } = await extractText(pdf, { mergePages: true });
      const result = text.trim();
      if (result) return result;
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      if (name === "PasswordException") continue; // wrong password — try next
      console.error("[pdf-decrypt] Error during PDF text extraction:", err);
      return null;
    }
  }
  return null;
}
