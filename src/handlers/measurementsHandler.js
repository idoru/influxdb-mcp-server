import { influxRequest, QUERY_TIMEOUT_MS } from "../utils/influxClient.js";
import { parseFluxCsv } from "../utils/csv.js";
import { decodeUriParam, fluxString } from "../utils/flux.js";
import { DEFAULT_ORG } from "../config/env.js";

// Resource: Get Measurements in a Bucket
export async function bucketMeasurements(uri, { bucketName: rawBucketName }) {
  if (!DEFAULT_ORG) {
    console.error("Error: INFLUXDB_ORG environment variable is not set");
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          error: "INFLUXDB_ORG environment variable is not set",
        }),
      }],
    };
  }

  try {
    const bucketName = decodeUriParam("bucketName", rawBucketName);
    console.log(`Listing measurements in bucket '${bucketName}'`);

    const queryBody = JSON.stringify({
      query: `import "influxdata/influxdb/schema"

schema.measurements(bucket: ${fluxString(bucketName)})`,
      type: "flux",
    });

    const response = await influxRequest(
      "/api/v2/query?org=" + encodeURIComponent(DEFAULT_ORG),
      {
        method: "POST",
        body: queryBody,
      },
      QUERY_TIMEOUT_MS,
    );

    const responseText = await response.text();

    // Collect the _value column from every table in the response
    const measurements = parseFluxCsv(responseText).flatMap((table) => {
      const valueHeader = table.headers.find((header) => header.trim() === "_value");
      if (valueHeader === undefined) return [];
      return table.records
        .map((record) => (record[valueHeader] || "").trim())
        .filter((m) => m !== "");
    });

    console.log(`Found ${measurements.length} measurements`);

    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          bucket: bucketName,
          measurements,
        }),
      }],
    };
  } catch (error) {
    console.error(`Error in bucket measurements resource: ${error.message}`);

    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          error: `Error retrieving measurements: ${error.message}`,
        }),
      }],
    };
  }
}
