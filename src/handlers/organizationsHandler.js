import { influxRequest } from "../utils/influxClient.js";
import { INFLUXDB_TOKEN, INFLUXDB_URL } from "../config/env.js";

// Resource: List Organizations
export async function listOrganizations(uri) {
  console.log("Processing list organizations request - START");

  try {
    // Add detailed debug logging
    console.log(`INFLUXDB_URL: ${INFLUXDB_URL}`);
    console.log(`INFLUXDB_TOKEN set: ${INFLUXDB_TOKEN ? "Yes" : "No"}`);

    console.log("Making request to InfluxDB API...");
    // Our influxRequest function already has built-in timeout
    const response = await influxRequest("/api/v2/orgs", {}, 5000);
    console.log(
      "Organizations API response received, status:",
      response.status,
    );

    // Also add timeout for JSON parsing
    console.log("Parsing response body...");
    const data = await response.json();
    console.log(`Found ${data.orgs?.length || 0} organizations`);

    // If we have no orgs, return an empty array as stringified JSON in text field
    if (!data.orgs || data.orgs.length === 0) {
      console.log("No organizations found, returning empty list as JSON");
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({ orgs: [] }),
        }],
      };
    }

    // Return the organizations data as stringified JSON in text field
    console.log("Returning organization data as JSON...");

    // Prepare the result as JSON data in the text field
    const result = {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(data),
      }],
    };

    console.log("Successfully processed list organizations request - END");
    return result;
  } catch (error) {
    console.error("Error in list organizations resource:", error.message);
    console.error(error.stack);

    // Return error as stringified JSON in text field
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
