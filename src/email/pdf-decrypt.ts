/**
 * PDF utilities for the inbound email processor.
 *
 * - isEncryptedPdf: quick check before sending to Claude
 * - extractPdfText: decrypt + extract text with pdfjs-dist (Node.js, no worker)
 */

// pdfjs-dist legacy build works without a DOM / worker in Node.js serverless
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js") as typeof import("pdfjs-dist");

// Disable the worker — not available in Vercel serverless
pdfjs.GlobalWorkerOptions.workerSrc = "";

export async function isEncryptedPdf(data: Buffer): Promise<boolean> {
  try {
    await pdfjs.getDocument({ data: new Uint8Array(data), useWorkerFetch: false }).promise;
    return false;
  } catch (err: unknown) {
    // pdfjs throws PasswordException for encrypted PDFs
    return (err as { name?: string }).name === "PasswordException";
  }
}

// Returns extracted text, or null if none of the passwords worked.
export async function extractPdfText(
  data: Buffer,
  passwords: string[]
): Promise<string | null> {
  for (const password of passwords) {
    try {
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(data),
        password,
        useWorkerFetch: false,
      }).promise;

      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .filter((item) => "str" in item)
          .map((item) => (item as { str: string }).str)
          .join(" ");
        pages.push(text);
      }

      const result = pages.join("\n\n").trim();
      if (result) return result;
    } catch {
      // Wrong password — try next
    }
  }
  return null;
}
