// relevanceEngine.js — Conversation Relevance Engine (spec section 4).
//
// IMPORTANT HONESTY NOTE: this is a rule-based / keyword heuristic
// classifier, not a real NLU model. It exists so the full conversation
// pipeline (relevance -> steering -> RAG -> response) is wired end-to-end
// and testable without any paid AI provider. Classification quality here
// is intentionally basic. Once a real AI_PROVIDER with tool-use/structured
// output is connected (see server/services/ai/AIProvider.js), replace
// classify() with a real LLM call that returns the same shape — every
// caller (conversationOrchestrator.js) is written against this return
// shape, so no other file needs to change.

const OFF_TOPIC_KEYWORDS = ["weather", "cricket", "movie", "politics", "joke", "song", "recipe", "football", "election"];
const UNSAFE_KEYWORDS = ["otp", "pin", "cvv", "password", "upi pin", "atm pin", "bank login"];
const FEEDBACK_KEYWORDS = ["good", "bad", "satisfied", "unsatisfied", "happy", "unhappy", "complaint", "polite", "rude", "excellent", "poor", "waiting", "delay"];
const CLARIFICATION_KEYWORDS = ["what do you mean", "can you repeat", "didn't understand", "again please", "explain"];

const POSITIVE_WORDS = ["good", "great", "excellent", "happy", "satisfied", "polite", "thank", "nice", "love", "perfect"];
const NEGATIVE_WORDS = ["bad", "poor", "unhappy", "unsatisfied", "rude", "angry", "complaint", "delay", "waiting", "worst", "disappointed"];

function scoreSentiment(text) {
  const lower = text.toLowerCase();
  const positiveHits = POSITIVE_WORDS.filter((w) => lower.includes(w)).length;
  const negativeHits = NEGATIVE_WORDS.filter((w) => lower.includes(w)).length;
  if (positiveHits > 0 && negativeHits > 0) return "Mixed";
  if (positiveHits > negativeHits) return "Positive";
  if (negativeHits > positiveHits) return "Negative";
  return "Neutral";
}

// Extracts simple numeric entities (amounts) and matches configured
// extraction_fields by naive keyword proximity. Real entity extraction
// needs an LLM; this covers the common "budget is 30000" style utterance.
function extractEntities(text, extractionFields = []) {
  const entities = {};
  const numberMatch = text.match(/(\d{3,7})/);
  const budgetFieldNames = ["budget", "amount", "price"];

  for (const field of extractionFields) {
    const key = field.key || field.label?.toLowerCase().replace(/\s+/g, "_");
    if (!key) continue;
    if (field.type === "number" && numberMatch && budgetFieldNames.some((b) => key.includes(b))) {
      entities[key] = Number(numberMatch[1]);
    }
  }
  return entities;
}

/**
 * @param {Object} opts
 * @param {string} opts.text - the customer's utterance (already transcribed)
 * @param {Object} opts.agent - the agent row (includes allowed_topics, restricted_topics, extraction_fields)
 * @param {Array} opts.knowledgeMatches - chunks retrieved from vectorSearch for this utterance
 * @returns {{ relevance, sentiment, topic, entities, confidence }}
 */
export function classify({ text, agent, knowledgeMatches = [] }) {
  const lower = text.toLowerCase();

  let relevance = "UNKNOWN";
  let confidence = 0.4;

  if (UNSAFE_KEYWORDS.some((k) => lower.includes(k))) {
    relevance = "UNSAFE";
    confidence = 0.95;
  } else if (CLARIFICATION_KEYWORDS.some((k) => lower.includes(k))) {
    relevance = "CLARIFICATION";
    confidence = 0.7;
  } else if (OFF_TOPIC_KEYWORDS.some((k) => lower.includes(k))) {
    relevance = "OFF_TOPIC";
    confidence = 0.75;
  } else if (FEEDBACK_KEYWORDS.some((k) => lower.includes(k))) {
    relevance = (agent?.agent_type || "").toLowerCase().includes("survey") ? "SURVEY_RESPONSE" : "FEEDBACK";
    confidence = 0.65;
  } else if (knowledgeMatches.length > 0 && knowledgeMatches[0].similarity >= (agent?.confidence_threshold ?? 0.5)) {
    relevance = "BUSINESS_RELEVANT";
    confidence = Math.min(0.95, knowledgeMatches[0].similarity + 0.2);
  } else if (knowledgeMatches.length > 0) {
    relevance = "PARTIALLY_RELEVANT";
    confidence = 0.5;
  } else if (/\?|enty|cheppandi|price|cost|available/i.test(lower)) {
    relevance = "INFORMATION_REQUEST";
    confidence = 0.55;
  }

  return {
    relevance,
    sentiment: scoreSentiment(text),
    topic: knowledgeMatches[0]?.content?.slice(0, 60) || null,
    entities: extractEntities(text, agent?.extraction_fields || []),
    confidence: Number(confidence.toFixed(3)),
  };
}
