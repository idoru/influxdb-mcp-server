import { influxRequest } from "../utils/influxClient.js";
import { logMcpDebug } from "../utils/loggerConfig.js";

// Resource: List Organizations
export async function listOrganizations(uri) {
  try {
    const response = await influxRequest("/api/v2/orgs", {}, 5000);
    const data = await response.json();
    logMcpDebug(`Found ${data.orgs?.length || 0} organizations`);

    // Return an empty list when there are none, otherwise the API response
    const text = !data.orgs || data.orgs.length === 0
      ? JSON.stringify({ orgs: [] })
      : JSON.stringify(data);

    return {
      contents: [{
        uri: uri.href,
        text,
      }],
    };
  } catch (error) {
    console.error("Error in list organizations resource:", error.message);

    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          error: `Error retrieving organizations: ${error.message}`,
        }),
      }],
    };
  }
}
