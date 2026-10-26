import fetch from "node-fetch";
import { INFLUXDB_TOKEN, INFLUXDB_URL } from "../config/env.js";

export const DEFAULT_TIMEOUT_MS = 10000;
export const WRITE_TIMEOUT_MS = 30000;
export const QUERY_TIMEOUT_MS = 60000;

// Helper for InfluxDB API requests. The timeout covers the whole exchange,
// including reading the response body via text() or json(), not just the
// arrival of response headers.
export async function influxRequest(endpoint, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = `${INFLUXDB_URL}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const clear = () => clearTimeout(timeoutId);

  // Report aborts as timeouts rather than node-fetch's generic AbortError
  const describeError = (error) =>
    controller.signal.aborted
      ? new Error(`InfluxDB API request timed out after ${timeoutMs}ms`)
      : error;

  // Keep the timeout running until the body has been consumed
  const readBody = async (read) => {
    try {
      return await read();
    } catch (error) {
      throw describeError(error);
    } finally {
      clear();
    }
  };

  console.log(`Making ${options.method || "GET"} request to: ${url}`);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Token ${INFLUXDB_TOKEN}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: controller.signal,
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await readBody(() => response.text());
      throw new Error(`InfluxDB API Error (${response.status}): ${errorText}`);
    }

    if (response.status === 204 || !response.body) {
      clear();
    } else {
      const text = response.text.bind(response);
      const json = response.json.bind(response);
      response.text = () => readBody(text);
      response.json = () => readBody(json);
    }

    return response;
  } catch (error) {
    clear();
    const reported = describeError(error);
    console.error(`Error in influxRequest to ${url}:`, reported.message);
    throw reported;
  }
}
