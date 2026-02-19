import { influxRequest } from "../utils/influxClient.js";
import { DEFAULT_ORG } from "../config/env.js";

// Tool: Query Data
export async function queryData({ org: orgParam, query }) {
  const org = orgParam || DEFAULT_ORG;

  if (!org) {
    return {
      content: [{ type: "text", text: "Error: org is required. Provide it as a parameter or set INFLUXDB_ORG environment variable." }],
      isError: true,
    };
  }

  try {
    const response = await influxRequest(
      `/api/v2/query?org=${encodeURIComponent(org)}`,
      {
        method: "POST",
        body: JSON.stringify({ query, type: "flux" }),
      },
    );

    const responseText = await response.text();

    return {
      content: [{
        type: "text",
        text: responseText,
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error executing query: ${error.message}`,
      }],
      isError: true,
    };
  }
}
