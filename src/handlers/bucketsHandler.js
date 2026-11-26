import { influxRequest } from "../utils/influxClient.js";
import { logMcpDebug } from "../utils/loggerConfig.js";

// Resource: List Buckets
export async function listBuckets(uri) {
  try {
    const response = await influxRequest("/api/v2/buckets", {}, 5000);
    const data = await response.json();
    logMcpDebug(`Found ${data.buckets?.length || 0} buckets`);

    // Return an empty list when there are none, otherwise the API response
    const text = !data.buckets || data.buckets.length === 0
      ? JSON.stringify({ buckets: [] })
      : JSON.stringify(data);

    return {
      contents: [{
        uri: uri.href,
        text,
      }],
    };
  } catch (error) {
    console.error("Error in list buckets resource:", error.message);

    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          error: `Error retrieving buckets: ${error.message}`,
        }),
      }],
    };
  }
}
