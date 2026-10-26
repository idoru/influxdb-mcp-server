import { influxRequest } from "../utils/influxClient.js";

// Tool: Create Bucket
export async function createBucket({ name, orgID, retentionPeriodSeconds }) {
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

    const response = await influxRequest("/api/v2/buckets", {
      method: "POST",
      body: JSON.stringify(bucketData),
    });

    const bucketResponse = await response.json();

    return {
      content: [{
        type: "text",
        text:
          `Bucket created successfully:\nID: ${bucketResponse.id}\nName: ${bucketResponse.name}\nOrganization ID: ${bucketResponse.orgID}`,
      }],
    };
  } catch (error) {
    console.error(`Create-bucket tool error: ${error.message}`);
    return {
      content: [{
        type: "text",
        text: `Error creating bucket: ${error.message}`,
      }],
      isError: true,
    };
  }
}
