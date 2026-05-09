import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LLMProvider, LLMRequest, LLMMessage } from "./types";

function toAnthropicContent(
  content: LLMMessage["content"]
): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  return content.map((block) =>
    block.type === "image"
      ? {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: block.mediaType,
            data: block.data,
          },
        }
      : { type: "text" as const, text: block.text }
  );
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(model = "claude-sonnet-4-6") {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = model;
  }

  async complete(request: LLMRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 2048,
      system: request.systemPrompt,
      messages: request.messages.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: toAnthropicContent(m.content),
      })),
    });

    const block = response.content[0];
    if (block.type !== "text") throw new Error("Unexpected response type");
    return block.text;
  }

  async completeStructured<T>(
    request: LLMRequest,
    schema: z.ZodType<T>
  ): Promise<T> {
    const jsonSchema = z.toJSONSchema(schema);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.systemPrompt,
      tools: [
        {
          name: "structured_output",
          description: "Return the structured output matching the schema exactly.",
          input_schema: jsonSchema as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: "structured_output" },
      messages: request.messages.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: toAnthropicContent(m.content),
      })),
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("No tool_use block in Anthropic response");
    }

    return schema.parse(toolUse.input);
  }
}
