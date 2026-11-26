import { jest } from "@jest/globals";
import {
  createRunBucket,
  csvRecords,
  deleteRunResources,
  describeInflux,
  fieldValues,
  getJson,
  getOrgId,
  influx,
  measurementFlux,
  queryCsv,
  uniqueName,
  waitForInfluxDBReady,
  writeSampleData,
} from "../tests/support/influx.js";
import { createdId, resourceJson, toolText } from "../tests/support/mcp.js";

// Handlers are imported in beforeAll, after env.js is mocked
let listOrganizations;
let listBuckets;
let bucketMeasurements;
let executeQuery;
let writeData;
let queryData;
let createBucket;
let createOrg;

// The InfluxDB instance comes from INFLUXDB_TEST_* (see tests/support/influx.js)
const { url: INFLUXDB_URL, adminToken: INFLUXDB_ADMIN_TOKEN, org: INFLUXDB_ORG } = influx;
// This suite's own bucket, created and filled with sample data in beforeAll
const INFLUXDB_BUCKET = uniqueName("handlers");

jest.setTimeout(60000);

// Each resource and tool handler called directly, without the MCP protocol
describeInflux("InfluxDB MCP Server Direct Handler Tests", () => {
  beforeAll(async () => {
    await waitForInfluxDBReady();
    await createRunBucket("handlers");
    await writeSampleData(INFLUXDB_BUCKET);

    // Handlers read their settings from env.js when imported, so mock it first
    jest.unstable_mockModule("../src/config/env.js", () => ({
      INFLUXDB_URL,
      INFLUXDB_TOKEN: INFLUXDB_ADMIN_TOKEN,
      DEFAULT_ORG: INFLUXDB_ORG,
      DEFAULT_BUCKET: INFLUXDB_BUCKET,
      MAX_RESPONSE_BYTES: 10 * 1024 * 1024,
      READ_ONLY: false,
      ENABLE_QUERY_RESOURCE: false,
      validateEnvironment: () => {},
    }));

    ({ listOrganizations } = await import("../src/handlers/organizationsHandler.js"));
    ({ listBuckets } = await import("../src/handlers/bucketsHandler.js"));
    ({ bucketMeasurements } = await import("../src/handlers/measurementsHandler.js"));
    ({ executeQuery } = await import("../src/handlers/queryHandler.js"));
    ({ writeData } = await import("../src/handlers/writeDataTool.js"));
    ({ queryData } = await import("../src/handlers/queryDataTool.js"));
    ({ createBucket } = await import("../src/handlers/createBucketTool.js"));
    ({ createOrg } = await import("../src/handlers/createOrgTool.js"));
  });

  // Delete only the buckets and orgs this run created; a failure fails the suite
  afterAll(async () => {
    await deleteRunResources();
  });

  test("listOrganizations handler should return proper organizations", async () => {
    const { orgs } = resourceJson(await listOrganizations(new URL("influxdb://orgs")));
    expect(orgs.map((org) => org.name)).toContain(INFLUXDB_ORG);
  });

  test("listBuckets handler should return proper buckets", async () => {
    const { buckets } = resourceJson(await listBuckets(new URL("influxdb://buckets")));
    expect(buckets.map((bucket) => bucket.name)).toContain(INFLUXDB_BUCKET);
  });

  test("bucketMeasurements handler should return measurements for a bucket", async () => {
    const data = resourceJson(
      await bucketMeasurements(new URL(`influxdb://bucket/${INFLUXDB_BUCKET}/measurements`), {
        bucketName: INFLUXDB_BUCKET,
      }),
    );
    expect(data).toEqual({
      bucket: INFLUXDB_BUCKET,
      measurements: expect.arrayContaining(["cpu_usage", "temperature"]),
    });
  });

  test("executeQuery handler should execute Flux queries", async () => {
    const flux = measurementFlux(INFLUXDB_BUCKET, "cpu_usage");
    const orgName = encodeURIComponent(INFLUXDB_ORG);
    const fluxQuery = encodeURIComponent(flux);

    const result = resourceJson(
      await executeQuery(new URL(`influxdb://query/${orgName}/${fluxQuery}`), { orgName, fluxQuery }),
    );

    expect(result.query).toBe(flux);
    expect(result.organization).toBe(INFLUXDB_ORG);
    expect(result.data.length).toBeGreaterThan(0);
    expect(new Set(result.data.map((record) => record._measurement))).toEqual(new Set(["cpu_usage"]));
    expect(result.data.map((record) => record.host)).toEqual(expect.arrayContaining(["server01", "server02"]));
  });

  test("writeData tool handler should write data to InfluxDB", async () => {
    const timestamp = Date.now();
    const result = await writeData({
      org: INFLUXDB_ORG,
      bucket: INFLUXDB_BUCKET,
      data: `server_metrics,host=webserver01,region=us-west cpu=82.5,memory=65.2,connections=420i ${timestamp}`,
      precision: "ms",
    });
    expect(toolText(result)).toBe("Data written successfully");

    const csv = await queryCsv(measurementFlux(INFLUXDB_BUCKET, "server_metrics", { host: "webserver01" }));
    expect(fieldValues(csv)).toEqual({ cpu: "82.5", memory: "65.2", connections: "420" });
    expect(csvRecords(csv).map((record) => record.region)).toEqual(["us-west", "us-west", "us-west"]);
  });

  test("queryData tool handler should execute Flux queries", async () => {
    const csv = toolText(
      await queryData({ org: INFLUXDB_ORG, query: measurementFlux(INFLUXDB_BUCKET, "cpu_usage") }),
    );

    const records = csvRecords(csv);
    expect(records.length).toBeGreaterThan(0);
    expect(new Set(records.map((record) => record._measurement))).toEqual(new Set(["cpu_usage"]));
    expect(records.map((record) => record.host)).toEqual(expect.arrayContaining(["server01", "server02"]));
  });

  test("createBucket tool handler should create a new bucket", async () => {
    const orgID = await getOrgId();
    const name = uniqueName("bucket-handler");

    const text = toolText(await createBucket({ name, orgID, retentionPeriodSeconds: 3600 }));
    expect(text).toMatch(/^Bucket created successfully:/);

    const bucket = await getJson(`/api/v2/buckets/${createdId(text)}`);
    expect(bucket).toMatchObject({
      name,
      orgID,
      retentionRules: [expect.objectContaining({ type: "expire", everySeconds: 3600 })],
    });
  });

  test("createOrg tool handler should create a new organization", async () => {
    const name = uniqueName("org-handler");
    const description = "Created through direct handler test";

    const text = toolText(await createOrg({ name, description }));
    expect(text).toMatch(/^Organization created successfully:/);
    expect(text).toContain(`Description: ${description}`);

    expect(await getJson(`/api/v2/orgs/${createdId(text)}`)).toMatchObject({ name, description });
  });
});
