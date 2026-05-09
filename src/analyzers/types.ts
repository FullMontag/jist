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

  const output = await llm.completeStructured(
    {
      systemPrompt: analyzer.systemPrompt,
      messages: [{ role: "user", content: analyzer.buildPrompt(filtered) }],
      temperature: 0.1,
    },
    analyzer.outputSchema
  );

  return {
    analyzerId: analyzer.id,
    analyzerName: analyzer.name,
    output,
    emailsProcessed: filtered.length,
    runAt: new Date(),
  };
}
