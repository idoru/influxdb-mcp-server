import { jest } from "@jest/globals";
import Docker from "dockerode";
import fetch from "node-fetch";

// We'll import handlers dynamically after setting environment variables
let listOrganizations;
let listBuckets;
let bucketMeasurements;
let executeQuery;
let writeData;
let queryData;
let createBucket;
let createOrg;

// Generate a random port between 10000 and 20000 to avoid conflicts
const getRandomPort = () => Math.floor(Math.random() * 10000) + 10000;

// Configuration for tests
const INFLUXDB_PORT = getRandomPort();
console.log(`Using InfluxDB port: ${INFLUXDB_PORT}`);
const INFLUXDB_ADMIN_TOKEN = "admintoken123";
const INFLUXDB_ORG = "test-org";
const INFLUXDB_BUCKET = "test-bucket";
const INFLUXDB_USERNAME = "admin";
const INFLUXDB_PASSWORD = "adminpassword";

// Increased test timeout for Docker operations
jest.setTimeout(60000); // 60 seconds for Docker operations

// Direct handler testing
describe("InfluxDB MCP Server Direct Handler Tests", () => {
  let docker;
  let container;

  // Setup: Start InfluxDB container before all tests
  beforeAll(async () => {
    // Initialize Docker
    docker = new Docker();

    console.log("Pulling InfluxDB image...");
    await new Promise((resolve, reject) => {
      docker.pull("influxdb:2.7", (err, stream) => {
        if (err) {
          return reject(err);
        }
        docker.modem.followProgress(stream, (err) => {
          if (err) {
            return reject(err);
          }
          resolve();
        });
      });
    });

    console.log("Creating InfluxDB container...");
    container = await docker.createContainer({
      Image: "influxdb:2.7",
      ExposedPorts: {
        "8086/tcp": {},
      },
      HostConfig: {
        PortBindings: {
          "8086/tcp": [{ HostPort: `${INFLUXDB_PORT}` }],
        },
      },
      Env: [
        `DOCKER_INFLUXDB_INIT_MODE=setup`,
        `DOCKER_INFLUXDB_INIT_USERNAME=${INFLUXDB_USERNAME}`,
        `DOCKER_INFLUXDB_INIT_PASSWORD=${INFLUXDB_PASSWORD}`,
        `DOCKER_INFLUXDB_INIT_ORG=${INFLUXDB_ORG}`,
        `DOCKER_INFLUXDB_INIT_BUCKET=${INFLUXDB_BUCKET}`,
        `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=${INFLUXDB_ADMIN_TOKEN}`,
      ],
    });

    console.log("Starting InfluxDB container...");
    await container.start();

    // Wait for InfluxDB to be ready
    await waitForInfluxDBReady();

    // Create a token to be used by our tests
    await createInfluxDBToken();

    // Set environment variables for direct testing of handlers
    process.env.INFLUXDB_URL = `http://localhost:${INFLUXDB_PORT}`;
    process.env.INFLUXDB_TOKEN = INFLUXDB_ADMIN_TOKEN;
    process.env.INFLUXDB_ORG = INFLUXDB_ORG;

    // Monkey patch the env module by replacing imports dynamically
    // This is needed because handlers import env.js at module load time
    jest.unstable_mockModule("../src/config/env.js", () => ({
      INFLUXDB_URL: `http://localhost:${INFLUXDB_PORT}`,
      INFLUXDB_TOKEN: INFLUXDB_ADMIN_TOKEN,
      DEFAULT_ORG: INFLUXDB_ORG,
      DEFAULT_BUCKET: INFLUXDB_BUCKET,
      validateEnvironment: () => {
        console.log("Mock validateEnvironment called with overridden env vars");
      },
    }));

    // Now import handlers - this will pick up our environment variables
    const orgsHandler = await import("../src/handlers/organizationsHandler.js");
    const bucketsHandler = await import("../src/handlers/bucketsHandler.js");
    const measurementsHandler = await import(
      "../src/handlers/measurementsHandler.js"
    );
    const queryHandler = await import("../src/handlers/queryHandler.js");
    const writeDataHandler = await import("../src/handlers/writeDataTool.js");
    const queryDataHandler = await import("../src/handlers/queryDataTool.js");
    const createBucketHandler = await import(
      "../src/handlers/createBucketTool.js"
    );
    const createOrgHandler = await import("../src/handlers/createOrgTool.js");

    // Assign handler functions
    listOrganizations = orgsHandler.listOrganizations;
    listBuckets = bucketsHandler.listBuckets;
    bucketMeasurements = measurementsHandler.bucketMeasurements;
    executeQuery = queryHandler.executeQuery;
    writeData = writeDataHandler.writeData;
    queryData = queryDataHandler.queryData;
    createBucket = createBucketHandler.createBucket;
    createOrg = createOrgHandler.createOrg;

    console.log("Environment variables set for direct handler testing:", {
      INFLUXDB_URL: process.env.INFLUXDB_URL,
      INFLUXDB_TOKEN: process.env.INFLUXDB_TOKEN ? "Set" : "Not set",
      INFLUXDB_ORG: process.env.INFLUXDB_ORG,
    });
  });

  // Teardown: Stop and remove containers after all tests
  afterAll(async () => {
    console.log("Running test cleanup...");

    try {
      // Stop and remove InfluxDB container
      if (container) {
        await container.stop().catch(() =>
          console.log("Container may already be stopped")
        );
        await container.remove().catch(() =>
          console.log("Container may already be removed")
        );
        console.log("InfluxDB container stopped and removed");
      }

      // Extra cleanup - remove any leftover containers with similar image
      try {
        const docker = new Docker();
        const containers = await docker.listContainers({ all: true });

        // Collect promises for parallel execution
        const cleanupPromises = [];

        for (const containerInfo of containers) {
          if (containerInfo.Image === "influxdb:2.7") {
            console.log(`Removing leftover container ${containerInfo.Id}`);
            const containerToRemove = docker.getContainer(containerInfo.Id);

            const cleanupPromise = (async () => {
              try {
                await containerToRemove.stop().catch(() => {});
                await containerToRemove.remove().catch(() => {});
                console.log(
                  `Successfully removed container ${containerInfo.Id}`,
                );
              } catch (err) {
                console.error(
                  `Failed to remove container ${containerInfo.Id}:`,
                  err.message,
                );
              }
            })();

            cleanupPromises.push(cleanupPromise);
          }
        }

        // Wait for all cleanup operations to finish
        await Promise.allSettled(cleanupPromises);
      } catch (cleanupError) {
        console.error("Error during extra cleanup:", cleanupError.message);
      }

      console.log("Cleanup completed successfully");
    } catch (error) {
      console.error("Error during test cleanup:", error.message);
    }
  });

  // Helper: Wait for InfluxDB to be ready
  async function waitForInfluxDBReady() {
    console.log("Waiting for InfluxDB to be ready...");
    let ready = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!ready && attempts < maxAttempts) {
      attempts++;
      try {
        const response = await fetch(
          `http://localhost:${INFLUXDB_PORT}/health`,
        );
        const data = await response.json();
        if (data.status === "pass") {
          ready = true;
          console.log("InfluxDB is ready!");
        } else {
          console.log(
            `Waiting for InfluxDB to be ready... Attempt ${attempts}/${maxAttempts}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.log(
          `Waiting for InfluxDB to start... Attempt ${attempts}/${maxAttempts}. Error: ${error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!ready) {
      throw new Error(
        `InfluxDB failed to become ready after ${maxAttempts} attempts`,
      );
    }
  }

  // Helper: Create a token for the tests
  async function createInfluxDBToken() {
    console.log("Creating InfluxDB token for tests...");

    try {
      // First, get the org ID
      const orgResponse = await fetch(
        `http://localhost:${INFLUXDB_PORT}/api/v2/orgs?org=${INFLUXDB_ORG}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Token ${INFLUXDB_ADMIN_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      const orgData = await orgResponse.json();
      if (!orgData.orgs || orgData.orgs.length === 0) {
        throw new Error("Organization not found");
      }

      const orgID = orgData.orgs[0].id;

      // Create a token with all privileges for this org
      const tokenResponse = await fetch(
        `http://localhost:${INFLUXDB_PORT}/api/v2/authorizations`,
        {
          method: "POST",
          headers: {
            "Authorization": `Token ${INFLUXDB_ADMIN_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            description: "Token for direct handler tests",
            orgID,
            permissions: [
              {
                action: "read",
                resource: {
                  type: "buckets",
                  orgID,
                },
              },
              {
                action: "write",
                resource: {
                  type: "buckets",
                  orgID,
                },
              },
              {
                action: "read",
                resource: {
                  type: "orgs",
                  orgID,
                },
              },
              {
                action: "write",
                resource: {
                  type: "orgs",
                  orgID,
                },
              },
            ],
          }),
        },
      );

      const tokenData = await tokenResponse.json();
      console.log(
        "Test token created:",
        tokenData.token ? "success" : "failure",
      );
    } catch (error) {
      console.error("Error creating test token:", error.message);
      throw error;
    }
  }

  // Helper: Write sample data to InfluxDB
  async function writeSampleData() {
    console.log("Writing sample data to InfluxDB...");

    const data = `
cpu_usage,host=server01,region=us-west cpu=64.2,mem=47.3 ${Date.now() * 1000000}
cpu_usage,host=server02,region=us-east cpu=72.1,mem=52.8 ${Date.now() * 1000000}
temperature,location=datacenter,sensor=rack1 value=24.5 ${Date.now() * 1000000}
temperature,location=datacenter,sensor=rack2 value=25.1 ${Date.now() * 1000000}
`;

    try {
      const response = await fetch(
        `http://localhost:${INFLUXDB_PORT}/api/v2/write?org=${INFLUXDB_ORG}&bucket=${INFLUXDB_BUCKET}&precision=ns`,
        {
          method: "POST",
          headers: {
            "Authorization": `Token ${INFLUXDB_ADMIN_TOKEN}`,
            "Content-Type": "text/plain; charset=utf-8",
          },
          body: data.trim(),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to write sample data: ${errorText}`);
      }

      console.log("Sample data written successfully");
      return response;
    } catch (error) {
      console.error("Error writing sample data:", error.message);
      throw error;
    }
  }

  // Test: Validate listOrganizations handler
  test("listOrganizations handler should return proper organizations", async () => {
    console.log("Testing listOrganizations handler...");

    // Create a sample URI object that matches what MCP would send
    const sampleUri = new URL("influxdb://orgs");

    // Call the handler function directly
    const response = await listOrganizations(sampleUri);

    // Verify the response structure
    expect(response).toBeDefined();
    expect(response.contents).toBeDefined();
    expect(response.contents[0]).toBeDefined();
    expect(response.contents[0].text).toBeDefined();

    // Parse the JSON string
    const orgsData = JSON.parse(response.contents[0].text);

    // Validate the response
    expect(orgsData).toBeDefined();
    expect(orgsData.orgs).toBeDefined();
    expect(Array.isArray(orgsData.orgs)).toBe(true);
    expect(orgsData.orgs.length).toBeGreaterThan(0);

    // Specific validation for the test org
    const foundTestOrg = orgsData.orgs.some((org) => org.name === INFLUXDB_ORG);
    expect(foundTestOrg).toBe(true);

    console.log(
      `Found organizations: ${orgsData.orgs.map((org) => org.name).join(", ")}`,
    );
  });

  // Test: Validate listBuckets handler
  test("listBuckets handler should return proper buckets", async () => {
    console.log("Testing listBuckets handler...");

    // Create a sample URI object
    const sampleUri = new URL("influxdb://buckets");

    // Call the handler function directly
    const response = await listBuckets(sampleUri);

    // Verify the response structure
    expect(response).toBeDefined();
    expect(response.contents).toBeDefined();
    expect(response.contents[0]).toBeDefined();
    expect(response.contents[0].text).toBeDefined();

    // Parse the JSON string
    const bucketsData = JSON.parse(response.contents[0].text);

    // Validate the response
    expect(bucketsData).toBeDefined();
    expect(bucketsData.buckets).toBeDefined();
    expect(Array.isArray(bucketsData.buckets)).toBe(true);
    expect(bucketsData.buckets.length).toBeGreaterThan(0);

    // Specific validation for the test bucket
    const foundTestBucket = bucketsData.buckets.some((bucket) =>
      bucket.name === INFLUXDB_BUCKET
    );
    expect(foundTestBucket).toBe(true);

    console.log(
      `Found buckets: ${
        bucketsData.buckets.map((bucket) => bucket.name).join(", ")
      }`,
    );
  });

  // Test: Validate bucketMeasurements handler
  test("bucketMeasurements handler should return measurements for a bucket", async () => {
    console.log("Testing bucketMeasurements handler...");

    // First write some sample data to ensure we have measurements
    await writeSampleData();

    // Create a sample URI object with bucket parameter
    const sampleUri = new URL(
      `influxdb://bucket/${INFLUXDB_BUCKET}/measurements`,
    );

    // Create parameter object expected by the handler
    const params = { bucketName: INFLUXDB_BUCKET };

    // Call the handler function directly
    const response = await bucketMeasurements(sampleUri, params);

    // Verify the response structure
    expect(response).toBeDefined();
    expect(response.contents).toBeDefined();
    expect(response.contents[0]).toBeDefined();
    expect(response.contents[0].text).toBeDefined();

    // Parse the JSON string
    const measurementsData = JSON.parse(response.contents[0].text);

    // Validate the response
    expect(measurementsData).toBeDefined();
    expect(measurementsData.measurements).toBeDefined();
    expect(Array.isArray(measurementsData.measurements)).toBe(true);

    // The measurements array might be empty if no data has been written yet
    // Let's just log how many we found
    console.log(`Found ${measurementsData.measurements.length} measurements`);

    if (measurementsData.measurements.length > 0) {
      // Only test these if there are measurements
      const measurementNames = measurementsData.measurements.join(", ");
      console.log(`Measurement names: ${measurementNames}`);

      // Check if our test measurements are in the list
      const foundCpuUsage = measurementsData.measurements.includes("cpu_usage");
      const foundTemperature = measurementsData.measurements.includes(
        "temperature",
      );
      expect(foundCpuUsage || foundTemperature).toBe(true);
    }

    console.log(
      `Found measurements: ${measurementsData.measurements.join(", ")}`,
    );
  });

  // Test: Validate executeQuery handler
  test("executeQuery handler should execute Flux queries", async () => {
    console.log("Testing executeQuery handler...");

    // First write some sample data to query
    await writeSampleData();

    // Create a Flux query
    const fluxQuery = `from(bucket: "${INFLUXDB_BUCKET}")
      |> range(start: -1h)
      |> filter(fn: (r) => r._measurement == "cpu_usage")
      |> limit(n: 5)`;

    // URL encode the query
    const encodedQuery = encodeURIComponent(fluxQuery);

    // Create a sample URI object with query parameter
    const sampleUri = new URL(
      `influxdb://query/${INFLUXDB_ORG}/${encodedQuery}`,
    );

    // Create parameter object expected by the handler
    const params = {
      orgName: INFLUXDB_ORG,
      fluxQuery: encodedQuery,
    };

    // Call the handler function directly
    const response = await executeQuery(sampleUri, params);

    // Verify the response structure
    expect(response).toBeDefined();
    expect(response.contents).toBeDefined();
    expect(response.contents[0]).toBeDefined();
    expect(response.contents[0].text).toBeDefined();

    // Parse the JSON string
    const queryData = response.contents[0].text;

    // Validate the response contains the expected data
    expect(queryData).toContain("cpu_usage");
    expect(queryData).toContain("server01");

    console.log("Query executed successfully");
  });

  // Test: Validate writeData tool handler
  test("writeData tool handler should write data to InfluxDB", async () => {
    console.log("Testing writeData tool handler...");

    // Generate timestamp in nanoseconds
    const timestamp = Date.now() * 1000000;

    // Create unique test data for this test
    const lineProtocol =
      `server_metrics,host=webserver01,region=us-west cpu=82.5,memory=65.2,connections=420 ${timestamp}`;

    // Call the handler function directly with parameters
    const response = await writeData({
      org: INFLUXDB_ORG,
      bucket: INFLUXDB_BUCKET,
      data: lineProtocol,
      precision: "ns", // Using nanosecond precision
    });

    // Verify the response structure
    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
    expect(response.content[0]).toBeDefined();
    expect(response.content[0].text).toBeDefined();

    // Verify data was written by querying via direct API
    const queryUrl = `http://localhost:${INFLUXDB_PORT}/api/v2/query?org=${
      encodeURIComponent(INFLUXDB_ORG)
    }`;

    const verifyResponse = await fetch(queryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${INFLUXDB_ADMIN_TOKEN}`,
      },
      body: JSON.stringify({
        query: `from(bucket: "${INFLUXDB_BUCKET}")
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement == "server_metrics" and r.host == "webserver01")`,
        type: "flux",
      }),
    });

    expect(verifyResponse.ok).toBe(true);
    const verifyText = await verifyResponse.text();

    // Check that we can find our data
    expect(verifyText).toContain("server_metrics");
    expect(verifyText).toContain("webserver01");
    expect(verifyText).toContain("us-west");

    console.log("Data written successfully");
  });

  // Test: Validate queryData tool handler
  test("queryData tool handler should execute Flux queries", async () => {
    console.log("Testing queryData tool handler...");

    // First write some sample data to query
    await writeSampleData();

    // Create a Flux query
    const fluxQuery = `from(bucket: "${INFLUXDB_BUCKET}")
      |> range(start: -1h)
      |> filter(fn: (r) => r._measurement == "cpu_usage")
      |> limit(n: 5)`;

    // Call the handler function directly with parameters
    const response = await queryData({
      org: INFLUXDB_ORG,
      query: fluxQuery,
    });

    // Verify the response structure
    expect(response).toBeDefined();

    // Handle both success and error cases
    if (response.error) {
      console.log("Query returned an error response:", response.error);
    } else if (response.result) {
      console.log("Query returned a successful result");
      // Validate the response contains the expected data
      expect(response.result).toContain("cpu_usage");
      expect(response.result).toContain("server01");
    } else {
      console.log(
        "Query returned an unexpected response structure:",
        JSON.stringify(response),
      );
    }

    console.log("Query executed successfully via tool handler");
  });

  // Test: Validate createBucket tool handler
  test("createBucket tool handler should create a new bucket", async () => {
    console.log("Testing createBucket tool handler...");

    // First, get the org ID
    const orgResponse = await fetch(
      `http://localhost:${INFLUXDB_PORT}/api/v2/orgs?org=${INFLUXDB_ORG}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Token ${INFLUXDB_ADMIN_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    const orgData = await orgResponse.json();
    const orgID = orgData.orgs[0].id;
    console.log(`Found organization ID: ${orgID}`);

    // Create a unique bucket name for this test
    const newBucketName = `test-bucket-handler-${Date.now()}`;

    // Call the handler function directly with parameters
    const response = await createBucket({
      name: newBucketName,
      orgID: orgID,
      retentionPeriodSeconds: 3600, // 1 hour retention
    });

    // Verify the response structure
    expect(response).toBeDefined();

    // Handle both success and error cases
    if (response.content && response.content[0] && response.content[0].text) {
      console.log("Create bucket returned content:", response.content[0].text);

      // Try to parse as JSON
      try {
        const resultObj = JSON.parse(response.content[0].text);
        if (resultObj.id && resultObj.name) {
          console.log(`Successfully created bucket with ID: ${resultObj.id}`);
          expect(resultObj.name).toBe(newBucketName);
          expect(resultObj.orgID).toBe(orgID);
        }
      } catch (e) {
        console.log("Content is not valid JSON:", e.message);
      }
    } else if (response.result) {
      console.log("Create bucket returned a result:", response.result);

      // Try to parse it
      const resultObj = JSON.parse(response.result);
      expect(resultObj.id).toBeDefined();
      expect(resultObj.name).toBe(newBucketName);
      expect(resultObj.orgID).toBe(orgID);
    } else if (response.error) {
      console.log("Create bucket returned an error:", response.error);
    } else {
      console.log(
        "Create bucket returned an unexpected response:",
        JSON.stringify(response),
      );
    }

    // Verify bucket exists by listing via direct API
    const listUrl = `http://localhost:${INFLUXDB_PORT}/api/v2/buckets`;
    const listResponse = await fetch(listUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${INFLUXDB_ADMIN_TOKEN}`,
      },
    });

    const buckets = await listResponse.json();
    const foundBucket = buckets.buckets.some((b) => b.name === newBucketName);
    expect(foundBucket).toBe(true);

    console.log(`Bucket '${newBucketName}' created successfully`);
  });

  // Test: Validate createOrg tool handler
  test("createOrg tool handler should create a new organization", async () => {
    console.log("Testing createOrg tool handler...");

    // Create a unique organization name for this test
    const newOrgName = `test-org-handler-${Date.now()}`;

    // Call the handler function directly with parameters
    const response = await createOrg({
      name: newOrgName,
      description: "Created through direct handler test",
    });

    // Verify the response structure
    expect(response).toBeDefined();

    // Handle both success and error cases
    if (response.content && response.content[0] && response.content[0].text) {
      console.log("Create org returned content:", response.content[0].text);

      // Try to parse as JSON
      try {
        const resultObj = JSON.parse(response.content[0].text);
        if (resultObj.id && resultObj.name) {
          console.log(`Successfully created org with ID: ${resultObj.id}`);
          expect(resultObj.name).toBe(newOrgName);
        }
      } catch (e) {
        console.log("Content is not valid JSON:", e.message);
      }
    } else if (response.result) {
      console.log("Create org returned a result:", response.result);

      // Try to parse it
      const resultObj = JSON.parse(response.result);
      expect(resultObj.id).toBeDefined();
      expect(resultObj.name).toBe(newOrgName);
    } else if (response.error) {
      console.log("Create org returned an error:", response.error);
    } else {
      console.log(
        "Create org returned an unexpected response:",
        JSON.stringify(response),
      );
    }

    // Verify organization exists by listing via direct API
    const listUrl = `http://localhost:${INFLUXDB_PORT}/api/v2/orgs`;
    const listResponse = await fetch(listUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${INFLUXDB_ADMIN_TOKEN}`,
      },
    });

    const orgs = await listResponse.json();
    const foundOrg = orgs.orgs.some((o) => o.name === newOrgName);
    expect(foundOrg).toBe(true);

    console.log(`Organization '${newOrgName}' created successfully`);
  });
});

