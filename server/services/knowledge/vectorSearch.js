// vectorSearch.js — semantic search over knowledge_chunks using pgvector cosine distance.
import { query } from "../../db/pool.js";
import { createEmbeddingProvider, toSqlVector } from "./embeddings.js";

const embeddingProvider = createEmbeddingProvider();

/**
 * @param {string} questionText
 * @param {string[]} knowledgeBaseIds
 * @param {number} topK
 */
export async function searchRelevantChunks(questionText, knowledgeBaseIds, topK = 5) {
  if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) return [];

  const queryEmbedding = await embeddingProvider.embed(questionText);
  const vectorLiteral = toSqlVector(queryEmbedding);

  const { rows } = await query(
    `SELECT id, document_id, content, 1 - (embedding <=> $1::vector) AS similarity
     FROM knowledge_chunks
     WHERE knowledge_base_id = ANY($2::uuid[])
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vectorLiteral, knowledgeBaseIds, topK]
  );
  return rows;
}
