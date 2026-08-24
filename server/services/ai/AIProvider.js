// AIProvider — abstract interface every LLM backend must implement.
// Swap providers purely through env vars (AI_PROVIDER=...); no other code should change.
export class AIProvider {
  /**
   * @param {Object} opts
   * @param {string} opts.systemPrompt
   * @param {Array<{role:'user'|'assistant', content:string}>} opts.messages
   * @param {string} [opts.context] - RAG context injected from the knowledge base
   * @param {number} [opts.temperature]
   * @returns {Promise<{ text: string, usedFallback: boolean }>}
   */
  async generateResponse(_opts) {
    throw new Error("generateResponse() not implemented");
  }
}

// Development/mock implementation — deterministic, no external calls, no API key needed.
// This lets the whole app (RAG, campaigns, live-call simulation) be tested without
// real AI provider credentials. Swap in a real provider by implementing AIProvider
// and selecting it in index.js based on process.env.AI_PROVIDER.
export class MockAIProvider extends AIProvider {
  async generateResponse({ systemPrompt = "", context = "", messages = [], fallbackMessage }) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";

    if (!context || context.trim().length === 0) {
      return {
        text: fallbackMessage || "I don't have enough information to answer that accurately. I can connect you with a human representative.",
        usedFallback: true,
      };
    }

    // Deterministic mock: surfaces the retrieved context so devs can verify RAG wiring end-to-end.
    const snippet = context.slice(0, 220).trim();
    return {
      text: `[MOCK AI] Based on the knowledge base: "${snippet}${context.length > 220 ? "..." : ""}" — regarding "${lastUserMsg}".`,
      usedFallback: false,
    };
  }
}

export function createAIProvider() {
  const provider = (process.env.AI_PROVIDER || "mock").toLowerCase();
  switch (provider) {
    case "mock":
      return new MockAIProvider();
    // case "anthropic": return new AnthropicAIProvider(process.env.AI_API_KEY);
    // case "openai":    return new OpenAIProvider(process.env.AI_API_KEY);
    default:
      console.warn(`[ai] Unknown AI_PROVIDER="${provider}", falling back to mock.`);
      return new MockAIProvider();
  }
}
