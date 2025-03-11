import fetch from "node-fetch";
import { INFLUXDB_TOKEN, INFLUXDB_URL } from "../config/env.js";

// Tool: Create Bucket
export async function createBucket({ name, orgID, retentionPeriodSeconds }) {
  console.log(`=== CREATE-BUCKET TOOL CALLED ===`);
  console.log(`Creating bucket: ${name}, orgID: ${orgID}`);

  try {
    const bucketData = {
      name,
      orgID,
      retentionRules: retentionPeriodSeconds
        ? [
          { type: "expire", everySeconds: retentionPeriodSeconds },
        ]
        : undefined,
    };

    console.log(`Creating bucket with data: ${JSON.stringify(bucketData)}`);

    // Use fetch directly instead of our wrapper
    const response = await fetch(`${INFLUXDB_URL}/api/v2/buckets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${INFLUXDB_TOKEN}`,
      },
      body: JSON.stringify(bucketData),
    });

    console.log(`Create bucket response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to create bucket: ${response.status} ${errorText}`,
      );
    }

    const bucketResponse = await response.json();

    console.log(`=== CREATE-BUCKET TOOL COMPLETED SUCCESSFULLY ===`);
    return {
      content: [{
        type: "text",
        text:
          `Bucket created successfully:\nID: ${bucketResponse.id}\nName: ${bucketResponse.name}\nOrganization ID: ${bucketResponse.orgID}`,
      }],
    };
  } catch (error) {
    console.error(`=== CREATE-BUCKET TOOL ERROR: ${error.message} ===`);
    return {
      content: [{
        type: "text",
        text: `Error creating bucket: ${error.message}`,
      }],
      isError: true,
    };
  }
}
