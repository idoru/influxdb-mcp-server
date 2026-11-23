import fetch from "node-fetch";
import { INFLUXDB_TOKEN, INFLUXDB_URL, MAX_RESPONSE_BYTES } from "../config/env.js";

export const DEFAULT_TIMEOUT_MS = 10000;
export const WRITE_TIMEOUT_MS = 30000;
export const QUERY_TIMEOUT_MS = 60000;
// InfluxDB error bodies are short; cap what is echoed back to clients
export const MAX_ERROR_BODY_BYTES = 2048;

class ResponseTooLargeError extends Error {
  constructor(maxBytes) {
    super(`InfluxDB response exceeded ${maxBytes} bytes`);
    this.name = "ResponseTooLargeError";
  }
}

// Read a response body as UTF-8 text without buffering more than maxBytes.
// Oversized bodies throw, or with truncate are cut off and marked.
async function readLimitedText(response, maxBytes, { truncate = false } = {}) {
  const declared = Number(response.headers.get("content-length"));
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!response.body) return "";

  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for await (const chunk of response.body) {
    if (total + chunk.length > maxBytes) {
      if (!truncate) throw new ResponseTooLargeError(maxBytes);
      text += decoder.decode(chunk.subarray(0, maxBytes - total), { stream: true });
      return `${text}${decoder.decode()} [truncated]`;
    }
    total += chunk.length;
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

// Describe a failure to reach InfluxDB without exposing its URL to clients
function describeFetchError(error) {
  if (error.type === "no-redirect" || /redirect/i.test(error.cause?.message || "")) {
    return new Error("InfluxDB answered with a redirect, which is not followed; check INFLUXDB_URL");
  }
  const code = error.code || error.cause?.code;
  return new Error(`Could not reach InfluxDB${code ? ` (${code})` : ""}`);
}

// Helper for InfluxDB API requests. The timeout covers the whole exchange,
// including reading the response body via text() or json(), not just the
// arrival of response headers. Response bodies are capped at
// MAX_RESPONSE_BYTES.
export async function influxRequest(endpoint, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = `${INFLUXDB_URL}${endpoint}`;
  const method = options.method || "GET";
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const clear = () => clearTimeout(timeoutId);

  const timeoutError = () => new Error(`InfluxDB API request timed out after ${timeoutMs}ms`);

  // Keep the timeout running until the body has been consumed, and drop the
  // connection when the body is abandoned (e.g. because it is too large)
  const readBody = async (read) => {
    try {
      return await read();
    } catch (error) {
      controller.abort();
      throw timedOut ? timeoutError() : error;
    } finally {
      clear();
    }
  };

  console.log(`Making ${method} request to: ${url}`);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Token ${INFLUXDB_TOKEN}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      // Never forward the token to wherever a redirect points
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    clear();
    console.error(`Error in influxRequest ${method} ${url}:`, error.message);
    throw timedOut ? timeoutError() : describeFetchError(error);
  }

  console.log(`Response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await readBody(() => readLimitedText(response, MAX_ERROR_BODY_BYTES, { truncate: true }));
    throw new Error(`InfluxDB API Error (${response.status}): ${errorText}`);
  }

  if (response.status === 204 || !response.body) {
    clear();
  } else {
    const text = () => readBody(() => readLimitedText(response, MAX_RESPONSE_BYTES));
    response.text = text;
    response.json = async () => JSON.parse(await text());
  }

  return response;
}
