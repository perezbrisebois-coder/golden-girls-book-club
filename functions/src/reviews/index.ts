import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { ClaudeProvider } from "./claude";
import { FakeProvider } from "./fake";
import type { ReviewProvider } from "./types";
import { ProviderUnavailableError } from "./types";

export * from "./types";

export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

/** Builds the providers listed in REVIEW_PROVIDERS (default "claude"), in order. */
export function getProviders(): ReviewProvider[] {
  const names = (process.env.REVIEW_PROVIDERS || "claude")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return names.map((name) => {
    switch (name) {
      case "claude":
        return new ClaudeProvider(ANTHROPIC_API_KEY.value());
      case "fake":
        return new FakeProvider();
      // case "openai": return new OpenAIProvider(...);   // future
      // case "gemini": return new GeminiProvider(...);   // future
      default:
        throw new Error(`Unknown review provider "${name}" in REVIEW_PROVIDERS`);
    }
  });
}

/** Tries each configured provider in turn; throws ProviderUnavailableError if all fail. */
export async function withProviders<T>(task: (p: ReviewProvider) => Promise<T>): Promise<T> {
  for (const provider of getProviders()) {
    try {
      return await task(provider);
    } catch (err) {
      logger.warn(`Review provider "${provider.name}" failed`, { error: String(err) });
    }
  }
  throw new ProviderUnavailableError("All review providers failed");
}
