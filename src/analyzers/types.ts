import { z } from "zod";
import type { RawEmail } from "@/gmail/fetcher";
import type { LLMProvider, MediaContentBlock } from "@/llm/types";
import type { ProviderName } from "@/llm";

export interface Analyzer<TOutput> {
  id: string;
  name: string;
  description: string;
  /** Which LLM provider to use for this analyzer */
  provider: ProviderName;
  /** Filter emails down to only the ones relevant to this analyzer */
  filter(emails: RawEmail[]): RawEmail[];
  /** System prompt sent to the LLM */
  systemPrompt: string;
  /** Build the user message from filtered emails */
  buildPrompt(emails: RawEmail[]): string;
  /** Zod schema the LLM response must conform to */
  outputSchema: z.ZodType<TOutput>;
}

export interface AnalyzerResult<TOutput = unknown> {
  analyzerId: string;
  analyzerName: string;
  output: TOutput;
  emailsProcessed: number;
  runAt: Date;
}

export async function runAnalyzer<T>(
  analyzer: Analyzer<T>,
  allEmails: RawEmail[],
  llm: LLMProvider,
  userKeywords: string[] = []
): Promise<AnalyzerResult<T> | null> {
  let filtered = analyzer.filter(allEmails);

  // Also include emails that match the user's learned service keywords but
  // didn't make it through the static keyword filter.
  if (userKeywords.length > 0) {
    const seen = new Set(filtered.map((e) => e.id));
    const extra = allEmails.filter((e) => {
      if (seen.has(e.id)) return false;
      const text = `${e.subject} ${e.from} ${e.snippet}`.toLowerCase();
      return userKeywords.some((kw) => text.includes(kw));
    });
    filtered = [...filtered, ...extra];
  }

  if (filtered.length === 0) return null;
  return runAnalyzerOn(analyzer, filtered, llm);
}

// Like runAnalyzer but skips the keyword filter — use for inbound emails that
// the user explicitly forwarded (they already decided the email is relevant).
// Pass `images` to include receipt photos or scanned documents alongside the text.
export async function runAnalyzerNoFilter<T>(
  analyzer: Analyzer<T>,
  emails: RawEmail[],
  llm: LLMProvider,
  images: MediaContentBlock[] = []
): Promise<AnalyzerResult<T> | null> {
  if (emails.length === 0 && images.length === 0) return null;
  return runAnalyzerOn(analyzer, emails, llm, images);
}

async function runAnalyzerOn<T>(
  analyzer: Analyzer<T>,
  emails: RawEmail[],
  llm: LLMProvider,
  images: MediaContentBlock[] = []
): Promise<AnalyzerResult<T>> {
  const textPrompt = analyzer.buildPrompt(emails);
  const content = images.length > 0
    ? [{ type: "text" as const, text: textPrompt }, ...images]
    : textPrompt;

  const output = await llm.completeStructured(
    {
      systemPrompt: analyzer.systemPrompt,
      messages: [{ role: "user", content }],
      temperature: 0.1,
    },
    analyzer.outputSchema
  );

  return {
    analyzerId: analyzer.id,
    analyzerName: analyzer.name,
    output,
    emailsProcessed: emails.length,
    runAt: new Date(),
  };
}
