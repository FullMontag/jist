import { z } from "zod";

export interface ImageContentBlock {
  type: "image";
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string; // base64-encoded
}

export interface DocumentContentBlock {
  type: "document";
  mediaType: "application/pdf";
  data: string; // base64-encoded
}

export type MediaContentBlock = ImageContentBlock | DocumentContentBlock;

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  // string for normal text-only messages; array to mix text + images + docs
  content: string | Array<{ type: "text"; text: string } | MediaContentBlock>;
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
