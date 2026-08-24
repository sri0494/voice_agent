// embeddings.js — EmbeddingProvider abstraction + mock implementation.
// Real providers (OpenAI text-embedding-3, Voyage, Cohere, etc.) should
// implement embed() and be selected via EMBEDDING_PROVIDER.
const EMBEDDING_DIM = 1536; // must match `vector(1536)` column in schema.sql

export class EmbeddingProvider {
  async embed(_text) { throw new Error("embed() not implemented"); }
}

// Deterministic hash-based pseudo-embedding — NOT semantically meaningful,
// but lets the whole pipeline (chunk -> store -> similarity search -> RAG)
// be exercised end-to-end without any external API key.
export class MockEmbeddingProvider extends EmbeddingProvider {
  async embed(text) {
    const vec = new Array(EMBEDDING_DIM).fill(0);
    for (let i = 0; i < text.length; i++) {
      const idx = text.charCodeAt(i) % EMBEDDING_DIM;
      vec[idx] += 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

export function createEmbeddingProvider() {
  const provider = (process.env.EMBEDDING_PROVIDER || "mock").toLowerCase();
  switch (provider) {
    case "mock":
      return new MockEmbeddingProvider();
    // case "openai": return new OpenAIEmbeddingProvider(process.env.EMBEDDING_API_KEY);
    default:
      console.warn(`[embeddings] Unknown EMBEDDING_PROVIDER="${provider}", falling back to mock.`);
      return new MockEmbeddingProvider();
  }
}

export function toSqlVector(floatArray) {
  return `[${floatArray.join(",")}]`;
}
