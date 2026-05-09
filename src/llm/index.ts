export { AnthropicProvider } from "./anthropic";
export type { LLMProvider, LLMRequest, LLMMessage } from "./types";

import { AnthropicProvider } from "./anthropic";
import type { LLMProvider } from "./types";

export type ProviderName = "anthropic";

export function createProvider(name: ProviderName = "anthropic"): LLMProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
