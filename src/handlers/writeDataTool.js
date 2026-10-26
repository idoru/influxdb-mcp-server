import { influxRequest, WRITE_TIMEOUT_MS } from "../utils/influxClient.js";
import { DEFAULT_ORG, DEFAULT_BUCKET } from "../config/env.js";

// Tool: Write Data
export async function writeData({ org: orgParam, bucket: bucketParam, data, precision }) {
  const org = orgParam || DEFAULT_ORG;
  const bucket = bucketParam || DEFAULT_BUCKET;

  if (!org) {
    return {
      content: [{ type: "text", text: "Error: org is required. Provide it as a parameter or set INFLUXDB_ORG environment variable." }],
      isError: true,
    };
  }
  if (!bucket) {
    return {
      content: [{ type: "text", text: "Error: bucket is required. Provide it as a parameter or set INFLUXDB_BUCKET environment variable." }],
      isError: true,
    };
  }

  console.log(`Writing to org: ${org}, bucket: ${bucket}, data length: ${data.length}`);

  try {
    const params = new URLSearchParams({ org, bucket });
    if (precision) {
      params.set("precision", precision);
    }

    const response = await influxRequest(
      `/api/v2/write?${params}`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: data,
      },
      WRITE_TIMEOUT_MS,
    );
    // InfluxDB OSS answers 204, but proxies or Cloud may include a body;
    // consume it so the request timer is released
    await response.text();

    return {
      content: [{
        type: "text",
        text: "Data written successfully",
      }],
    };
  } catch (error) {
    console.error(`Write-data tool error: ${error.message}`);
    return {
      content: [{
        type: "text",
        text: `Error writing data: ${error.message}`,
      }],
      isError: true,
    };
  }
}
