import { influxRequest } from "../utils/influxClient.js";
import { INFLUXDB_TOKEN, INFLUXDB_URL } from "../config/env.js";

// Resource: List Buckets
export async function listBuckets(uri) {
  console.log("Processing list buckets request - START");

  try {
    // Add detailed debug logging
    console.log(`INFLUXDB_URL: ${INFLUXDB_URL}`);
    console.log(`INFLUXDB_TOKEN set: ${INFLUXDB_TOKEN ? "Yes" : "No"}`);

    console.log("Making request to InfluxDB API for buckets...");
    // Our influxRequest function already has built-in timeout
    const response = await influxRequest("/api/v2/buckets", {}, 5000);
    console.log(
      "Buckets API response received, status:",
      response.status,
    );

    // Also add timeout for JSON parsing
    console.log("Parsing response body for buckets...");
    const data = await response.json();
    console.log(`Found ${data.buckets?.length || 0} buckets`);

    // If we have no buckets, return an empty array as stringified JSON in text field
    if (!data.buckets || data.buckets.length === 0) {
      console.log("No buckets found, returning empty list as JSON");
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({ buckets: [] }),
        }],
      };
    }

    // Return the buckets data as stringified JSON in text field
    console.log("Returning bucket data as JSON...");

    // Prepare the result as JSON data in text field
    const result = {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(data),
      }],
    };

    console.log("Successfully processed list buckets request - END");
    return result;
  } catch (error) {
    console.error("Error in list buckets resource:", error.message);
    console.error(error.stack);

    // Return error as stringified JSON in text field
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
