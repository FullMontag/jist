import { z } from "zod";

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  name: string;
  complete(request: LLMRequest): Promise<string>;
  completeStructured<T>(
    request: LLMRequest,
    schema: z.ZodType<T>
  ): Promise<T>;
}
