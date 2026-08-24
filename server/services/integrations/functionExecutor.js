// functionExecutor.js — executes a defined integration_function against the
// real external API. Used by: (1) the "Test Function" button in the
// Integrations UI, and (2) will be the call target for real LLM function-calling
// once a real AI_PROVIDER with tool-use support is connected (see AIProvider.js —
// the mock provider does not support tool calls; a real provider's tool-call
// response should be routed here with the resolved functionId + params).
import { query } from "../../db/pool.js";
import { decryptCredentials } from "../../utils/crypto.js";
import { logger } from "../../utils/logger.js";

// Fills {placeholders} in a path template from the provided params, e.g.
// "/customers/{mobile}" + { mobile: "9876543210" } -> "/customers/9876543210"
function fillPathTemplate(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (!(key in params)) throw new Error(`Missing required parameter: ${key}`);
    return encodeURIComponent(params[key]);
  });
}

function buildAuthHeaders(authType, credentials) {
  switch (authType) {
    case "API_KEY":
      return credentials.headerName
        ? { [credentials.headerName]: credentials.apiKey }
        : { "X-API-Key": credentials.apiKey };
    case "BEARER_TOKEN":
      return { Authorization: `Bearer ${credentials.token}` };
    case "BASIC_AUTH":
      return { Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}` };
    case "OAUTH2":
      // OAuth2 typically requires a token-refresh flow; assumes a valid
      // access token has already been obtained and stored as `credentials.accessToken`.
      return { Authorization: `Bearer ${credentials.accessToken}` };
    case "NONE":
    default:
      return {};
  }
}

/**
 * @param {string} functionId - integration_functions.id
 * @param {Object} params - input parameters, validated loosely against input_schema
 */
export async function executeFunction(functionId, params = {}) {
  const { rows } = await query(
    `SELECT f.*, i.base_url, i.auth_type, i.encrypted_credentials, i.headers AS static_headers,
            i.timeout_ms, i.name AS integration_name
     FROM integration_functions f
     JOIN business_integrations i ON i.id = f.integration_id
     WHERE f.id = $1`,
    [functionId]
  );
  const fn = rows[0];
  if (!fn) throw new Error("Function not found");
  if (!fn.base_url) throw new Error(`Integration "${fn.integration_name}" has no base URL configured`);

  const credentials = fn.encrypted_credentials ? decryptCredentials(fn.encrypted_credentials) : {};
  const path = fillPathTemplate(fn.path_template, params);
  const url = `${fn.base_url.replace(/\/$/, "")}${path}`;

  const authHeaders = buildAuthHeaders(fn.auth_type, credentials);
  const headers = { "Content-Type": "application/json", ...(fn.static_headers || {}), ...authHeaders };

  const isBodyMethod = ["POST", "PUT", "PATCH"].includes(fn.http_method);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fn.timeout_ms || 10000);

  try {
    const response = await fetch(url, {
      method: fn.http_method,
      headers,
      body: isBodyMethod ? JSON.stringify(params) : undefined,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();

    logger.info("integration_function_executed", { functionId, functionName: fn.function_name, status: response.status });

    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    logger.error("integration_function_failed", { functionId, functionName: fn.function_name, error: err.message });
    throw new Error(`Request to ${fn.integration_name} failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}
