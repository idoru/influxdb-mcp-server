import { influxRequest, QUERY_TIMEOUT_MS } from "../utils/influxClient.js";
import { parseFluxCsv } from "../utils/csv.js";
import { decodeUriParam } from "../utils/flux.js";

// Resource: Query data as a resource
export async function executeQuery(uri, { orgName: rawOrgName, fluxQuery }) {
  try {
    const orgName = decodeUriParam("orgName", rawOrgName);
    const decodedQuery = decodeUriParam("fluxQuery", fluxQuery);
    console.log(`Query resource for org: ${orgName}, query length: ${decodedQuery.length}`);

    const response = await influxRequest(
      `/api/v2/query?org=${encodeURIComponent(orgName)}`,
      {
        method: "POST",
        body: JSON.stringify({ query: decodedQuery, type: "flux" }),
      },
      QUERY_TIMEOUT_MS,
    );

    const responseText = await response.text();
    const tables = parseFluxCsv(responseText);

    // Tables can have different columns; report the union in first-seen order
    const headers = [...new Set(tables.flatMap((table) => table.headers))];
    const data = tables.flatMap((table) => table.records);

    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          query: decodedQuery,
          organization: orgName,
          ...(data.length > 0 ? { headers } : {}),
          data,
        }),
      }],
    };
  } catch (error) {
    console.error(`Error in query resource: ${error.message}`);
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          error: `Error executing query: ${error.message}`,
        }),
      }],
    };
  }
}
