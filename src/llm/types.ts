import { z } from "zod";

export interface ImageContentBlock {
  type: "image";
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string; // base64-encoded
}

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  // string for normal text-only messages; array to mix text + images
  content: string | Array<{ type: "text"; text: string } | ImageContentBlock>;
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
