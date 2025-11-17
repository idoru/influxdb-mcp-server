import { influxRequest } from "../utils/influxClient.js";
import { DEFAULT_ORG } from "../config/env.js";

// Resource: Get Measurements in a Bucket
export async function bucketMeasurements(uri, { bucketName }) {
  console.log(
    `Processing measurements in bucket '${bucketName}' request - START`,
  );

  if (!DEFAULT_ORG) {
    console.error("Error: INFLUXDB_ORG environment variable is not set");
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          error: "INFLUXDB_ORG environment variable is not set",
        }),
      }],
      error: true,
    };
  }

  try {
    // Use Flux query to get measurements
    console.log(
      `Creating Flux query for bucket '${bucketName}' measurements`,
    );
    const queryBody = JSON.stringify({
      query: `import "influxdata/influxdb/schema"

schema.measurements(bucket: "${bucketName}")`,
      type: "flux",
    });

    console.log(`Making InfluxDB API request for measurements...`);
    const response = await influxRequest(
      "/api/v2/query?org=" + encodeURIComponent(DEFAULT_ORG),
      {
        method: "POST",
        body: queryBody,
      },
      5000, // Explicit timeout
    );
    console.log(
      "Measurements API response received, status:",
      response.status,
    );

    console.log("Reading response text...");
    const responseText = await response.text();

    console.log("Parsing CSV response...");
    const lines = responseText
      .split("\n")
      .map((line) => line.replace(/\r/g, ""))
      .filter((line) => line.trim() !== "");
    console.log(`Found ${lines.length} lines in the response`);

    // Flux CSV responses include metadata rows that start with '#'
    const dataLines = lines.filter((line) => !line.startsWith("#"));
    console.log(`Found ${dataLines.length} data lines after removing metadata`);

    if (dataLines.length === 0) {
      console.log("No data rows found in the response");
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            bucket: bucketName,
            measurements: [],
          }),
        }],
      };
    }

    const headers = dataLines[0].split(",").map((header) => header.trim());
    const valueIndex = headers.indexOf("_value");
    console.log("Headers:", headers);
    console.log("Value index:", valueIndex);

    if (valueIndex === -1) {
      console.log("No _value column found in the response");
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            bucket: bucketName,
            measurements: [],
          }),
        }],
      };
    }

    console.log("Extracting measurement values...");
    const measurements = dataLines.slice(1)
      .map((line) => line.split(",")[valueIndex] || "")
      .map((value) => value.trim())
      .filter((m) => m !== "");

    console.log(`Found ${measurements.length} measurements`);
    console.log("Successfully processed measurements request - END");

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
    console.error(error.stack);

    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          error: `Error retrieving measurements: ${error.message}`,
        }),
      }],
      error: true,
    };
  }
}
