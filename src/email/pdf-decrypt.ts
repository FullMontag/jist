/**
 * PDF utilities for the inbound email processor.
 *
 * - isEncryptedPdf: quick check before sending to Claude
 * - extractPdfText: decrypt + extract text with pdfjs-dist (Node.js, no worker)
 *
 * pdfjs-dist is listed in serverExternalPackages so Next.js doesn't bundle it.
 */

import type * as PdfjsType from "pdfjs-dist";

// pdfjs-dist tries to polyfill canvas APIs on load and throws if they're missing.
// For text extraction we don't need actual rendering — stub the globals before importing.
function stubDomGlobals() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).DOMMatrix = class { constructor() { return {}; } };
  }
  if (typeof globalThis.ImageData === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ImageData = class { constructor() { return {}; } };
  }
  if (typeof globalThis.Path2D === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Path2D = class { constructor() { return {}; } };
  }
}

// Dynamic import at call time — avoids bundler issues with the .mjs build
async function getPdfjs(): Promise<typeof PdfjsType> {
  stubDomGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string) as typeof PdfjsType;
  pdfjs.GlobalWorkerOptions.workerSrc = "";
  return pdfjs;
}

// Encrypted PDFs always contain an /Encrypt entry — check the bytes directly.
// Faster and more reliable than loading pdfjs just to probe for encryption.
export function isEncryptedPdf(data: Buffer): boolean {
  return data.includes(Buffer.from("/Encrypt"));
}

// Returns extracted text, or null if none of the passwords worked.
export async function extractPdfText(
  data: Buffer,
  passwords: string[]
): Promise<string | null> {
  const pdfjs = await getPdfjs();

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
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      if (name === "PasswordException") {
        // Wrong password — try next
      } else {
        // pdfjs crashed for an unrelated reason — log and abort
        console.error("[pdf-decrypt] pdfjs error during decryption:", err);
        return null;
      }
    }
  }
  return null;
}
