import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { jest } from "@jest/globals";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import waitForExpect from "wait-for-expect";
import { fluxString } from "../src/utils/flux.js";
import {
  createRunBucket,
  csvRecords,
  deleteRunResources,
  describeInflux,
  fieldValues,
  getJson,
  getOrgId,
  influx,
  influxApi,
  measurementFlux,
  queryCsv,
  uniqueName,
  waitForInfluxDBReady,
  writeSampleData,
} from "./support/influx.js";
import {
  REQUEST_OPTIONS,
  SERVER_PATH,
  createdId,
  resourceJson,
  serverEnv,
  stopProcess,
  toolText,
  withMcpClient,
} from "./support/mcp.js";

jest.setTimeout(60000);

// The InfluxDB instance comes from INFLUXDB_TEST_* (see tests/support/influx.js)
const { url: INFLUXDB_URL, adminToken: INFLUXDB_ADMIN_TOKEN, org: INFLUXDB_ORG } = influx;
// This suite's own bucket, created and filled with sample data in beforeAll
const INFLUXDB_BUCKET = uniqueName("integration");

// Settings for every server this suite starts. create-bucket needs the admin token.
const SERVER_ENV = {
  INFLUXDB_URL,
  INFLUXDB_TOKEN: INFLUXDB_ADMIN_TOKEN,
  INFLUXDB_ORG,
};

const RETENTION_RULES = [expect.objectContaining({ type: "expire", everySeconds: 3600 })];

const parseJsonLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

// Read one resource through a fresh server and return its parsed JSON
const readResource = (uri, env = SERVER_ENV) =>
  withMcpClient(env, async (client) => resourceJson(await client.readResource({ uri }, REQUEST_OPTIONS)));

// Call one tool through a fresh server and return the text of its successful result
const callTool = (name, args) =>
  withMcpClient(SERVER_ENV, async (client) =>
    toolText(await client.callTool({ name, arguments: args }, undefined, REQUEST_OPTIONS)),
  );

// End-to-end tests against a real InfluxDB: the MCP server over stdio, and
// the InfluxDB API directly as a baseline. MCP tests never fall back to the
// API: if the server misbehaves, the test fails.
describeInflux("InfluxDB MCP Server Integration Tests", () => {
  beforeAll(async () => {
    await waitForInfluxDBReady();
    await createRunBucket("integration");
    await writeSampleData(INFLUXDB_BUCKET);
  });

  // Delete only the buckets and orgs this run created; a failure fails the suite
  afterAll(async () => {
    await deleteRunResources();
  });

  test("should write sample data to InfluxDB", async () => {
    await writeSampleData(INFLUXDB_BUCKET);

    const records = csvRecords(await queryCsv(measurementFlux(INFLUXDB_BUCKET, "temperature")));
    expect(records.map((record) => record.sensor)).toEqual(expect.arrayContaining(["rack1", "rack2"]));
  });

  test("should list organizations - direct API", async () => {
    const { orgs } = await getJson(`/api/v2/orgs?${new URLSearchParams({ org: INFLUXDB_ORG })}`);
    expect(orgs).toEqual([expect.objectContaining({ name: INFLUXDB_ORG })]);
  });

  test("should list organizations - MCP client", async () => {
    const { orgs } = await readResource("influxdb://orgs");
    expect(orgs.map((org) => org.name)).toContain(INFLUXDB_ORG);
  });

  test("should list buckets - direct API", async () => {
    const orgID = await getOrgId();
    const { buckets } = await getJson(`/api/v2/buckets?${new URLSearchParams({ name: INFLUXDB_BUCKET })}`);
    expect(buckets).toEqual([expect.objectContaining({ name: INFLUXDB_BUCKET, orgID })]);
  });

  test("should list buckets - MCP client", async () => {
    const { buckets } = await readResource("influxdb://buckets");
    expect(buckets.map((bucket) => bucket.name)).toContain(INFLUXDB_BUCKET);
  });

  test("should list measurements in a bucket - direct API", async () => {
    const csv = await queryCsv(
      `import "influxdata/influxdb/schema"\n\nschema.measurements(bucket: ${fluxString(INFLUXDB_BUCKET)})`,
    );
    expect(csvRecords(csv).map((record) => record._value)).toEqual(
      expect.arrayContaining(["cpu_usage", "temperature"]),
    );
  });

  test("should list measurements in a bucket - MCP client", async () => {
    const data = await readResource(`influxdb://bucket/${encodeURIComponent(INFLUXDB_BUCKET)}/measurements`);
    expect(data).toEqual({
      bucket: INFLUXDB_BUCKET,
      measurements: expect.arrayContaining(["cpu_usage", "temperature"]),
    });
  });

  // Talks to the server process without the SDK client: newline-delimited
  // JSON-RPC on stdin and stdout, as any MCP client would
  test("should write data over raw JSON-RPC on stdio", async () => {
    const timestamp = Date.now();
    const child = spawn(process.execPath, [SERVER_PATH], { env: serverEnv(SERVER_ENV) });
    const stdoutLines = [];
    createInterface({ input: child.stdout }).on("line", (line) => stdoutLines.push(line));
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    const responseTo = async (id) => {
      let response;
      await waitForExpect(() => {
        response = stdoutLines.map(parseJsonLine).find((message) => message?.id === id);
        expect(response).toBeDefined();
      }, 10000);
      return response;
    };

    try {
      send({
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "raw-stdio-test", version: "1.0.0" },
        },
      });
      expect((await responseTo(1)).result.serverInfo.name).toBe("InfluxDB");

      send({ method: "notifications/initialized" });
      send({
        id: 2,
        method: "tools/call",
        params: {
          name: "write-data",
          arguments: {
            org: INFLUXDB_ORG,
            bucket: INFLUXDB_BUCKET,
            data: `network_traffic,host=gateway01 bytes_in=1024i,bytes_out=2048i ${timestamp}`,
            precision: "ms",
          },
        },
      });
      const response = await responseTo(2);
      expect(response.error).toBeUndefined();
      expect(response.result.isError).toBeFalsy();
      expect(response.result.content).toEqual([{ type: "text", text: "Data written successfully" }]);

      // stdout is reserved for JSON-RPC; a log line there would break clients
      expect(stdoutLines.filter((line) => parseJsonLine(line)?.jsonrpc !== "2.0")).toEqual([]);
    } catch (error) {
      if (stderr.trim()) console.log(`MCP server stderr:\n${stderr.trim()}`);
      throw error;
    } finally {
      await stopProcess(child);
    }

    // Millisecond precision was honored: read as nanoseconds, the point would
    // be in 1970 and outside the queried hour
    const csv = await queryCsv(measurementFlux(INFLUXDB_BUCKET, "network_traffic", { host: "gateway01" }));
    expect(fieldValues(csv)).toEqual({ bytes_in: "1024", bytes_out: "2048" });
  });

  test("should write data using MCP client write-data tool", async () => {
    const timestamp = Date.now();
    const text = await callTool("write-data", {
      org: INFLUXDB_ORG,
      bucket: INFLUXDB_BUCKET,
      data: `server_metrics,host=webserver01,region=us-west cpu=82.5,memory=65.2,connections=420i ${timestamp}`,
      precision: "ms",
    });
    expect(text).toBe("Data written successfully");

    const csv = await queryCsv(measurementFlux(INFLUXDB_BUCKET, "server_metrics", { host: "webserver01" }));
    expect(fieldValues(csv)).toEqual({ cpu: "82.5", memory: "65.2", connections: "420" });
    expect(csvRecords(csv).map((record) => record.region)).toEqual(["us-west", "us-west", "us-west"]);
  });

  test("should query data using Flux - direct API", async () => {
    const records = csvRecords(await queryCsv(measurementFlux(INFLUXDB_BUCKET, "cpu_usage")));
    expect(records.map((record) => record.host)).toEqual(expect.arrayContaining(["server01", "server02"]));
  });

  test("should query data using MCP client query-data tool", async () => {
    const csv = await callTool("query-data", {
      org: INFLUXDB_ORG,
      query: measurementFlux(INFLUXDB_BUCKET, "cpu_usage"),
    });

    const records = csvRecords(csv);
    expect(records.length).toBeGreaterThan(0);
    expect(new Set(records.map((record) => record._measurement))).toEqual(new Set(["cpu_usage"]));
    expect(records.map((record) => record.host)).toEqual(expect.arrayContaining(["server01", "server02"]));
  });

  test("should create a new bucket - direct API", async () => {
    const orgID = await getOrgId();
    const name = uniqueName("bucket-direct");

    const response = await influxApi("/api/v2/buckets", {
      method: "POST",
      body: JSON.stringify({ name, orgID, retentionRules: [{ type: "expire", everySeconds: 3600 }] }),
    });
    expect(response.status).toBe(201);
    const { id } = await response.json();

    expect(await getJson(`/api/v2/buckets/${id}`)).toMatchObject({ name, orgID, retentionRules: RETENTION_RULES });
  });

  test("should create a new bucket using MCP client create-bucket tool", async () => {
    const orgID = await getOrgId();
    const name = uniqueName("bucket-mcp");

    const text = await callTool("create-bucket", { name, orgID, retentionPeriodSeconds: 3600 });
    expect(text).toMatch(/^Bucket created successfully:/);
    expect(text).toContain(`Name: ${name}`);
    expect(text).toContain(`Organization ID: ${orgID}`);

    // Check the bucket the tool reported, including its retention
    const bucket = await getJson(`/api/v2/buckets/${createdId(text)}`);
    expect(bucket).toMatchObject({ name, orgID, retentionRules: RETENTION_RULES });
  });

  test("should query data using Flux resource", async () => {
    const flux = measurementFlux(INFLUXDB_BUCKET, "cpu_usage");
    const uri = `influxdb://query/${encodeURIComponent(INFLUXDB_ORG)}/${encodeURIComponent(flux)}`;

    // The query resource is opt-in
    const result = await readResource(uri, { ...SERVER_ENV, INFLUXDB_ENABLE_QUERY_RESOURCE: "true" });

    expect(result.query).toBe(flux);
    expect(result.organization).toBe(INFLUXDB_ORG);
    expect(result.data.length).toBeGreaterThan(0);
    expect(new Set(result.data.map((record) => record._measurement))).toEqual(new Set(["cpu_usage"]));
    expect(result.data.map((record) => record.host)).toEqual(expect.arrayContaining(["server01", "server02"]));
  });

  test("should have consistent org IDs between buckets and orgs", async () => {
    const orgID = await getOrgId();
    const apiOrgIds = (await getJson("/api/v2/orgs")).orgs.map((org) => org.id);

    const { orgs, buckets } = await withMcpClient(SERVER_ENV, async (client) => ({
      orgs: resourceJson(await client.readResource({ uri: "influxdb://orgs" }, REQUEST_OPTIONS)).orgs,
      buckets: resourceJson(await client.readResource({ uri: "influxdb://buckets" }, REQUEST_OPTIONS)).buckets,
    }));
    const mcpOrgIds = orgs.map((org) => org.id);

    // The server reports the same orgs as the API
    expect([...mcpOrgIds].sort()).toEqual([...apiOrgIds].sort());
    // Every bucket it lists belongs to an org it lists, and this run's bucket to the test org
    expect(mcpOrgIds).toEqual(expect.arrayContaining([...new Set(buckets.map((bucket) => bucket.orgID))]));
    expect(buckets.find((bucket) => bucket.name === INFLUXDB_BUCKET)?.orgID).toBe(orgID);
  });
});
