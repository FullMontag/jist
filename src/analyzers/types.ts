import { z } from "zod";
import type { RawEmail } from "@/gmail/fetcher";
import type { LLMProvider } from "@/llm/types";
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
  llm: LLMProvider
): Promise<AnalyzerResult<T> | null> {
  const filtered = analyzer.filter(allEmails);
  if (filtered.length === 0) return null;
  return runAnalyzerOn(analyzer, filtered, llm);
}

// Like runAnalyzer but skips the keyword filter — use for inbound emails that
// the user explicitly forwarded (they already decided the email is relevant).
export async function runAnalyzerNoFilter<T>(
  analyzer: Analyzer<T>,
  emails: RawEmail[],
  llm: LLMProvider
): Promise<AnalyzerResult<T> | null> {
  if (emails.length === 0) return null;
  return runAnalyzerOn(analyzer, emails, llm);
}

async function runAnalyzerOn<T>(
  analyzer: Analyzer<T>,
  emails: RawEmail[],
  llm: LLMProvider
): Promise<AnalyzerResult<T>> {
  const output = await llm.completeStructured(
    {
      systemPrompt: analyzer.systemPrompt,
      messages: [{ role: "user", content: analyzer.buildPrompt(emails) }],
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
