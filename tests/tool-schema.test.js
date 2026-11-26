import { jest } from "@jest/globals";
import { withMcpClient } from "./support/mcp.js";

jest.setTimeout(15000);

// Spawn the server over stdio with the given env and run fn against a client.
// No InfluxDB instance is needed: listing tools and resources never hits the API.
const withClient = (extraEnv, fn) => withMcpClient({ INFLUXDB_TOKEN: "test-token", ...extraEnv }, fn);

// Return the server's tools keyed by name
async function listToolsWithEnv(extraEnv) {
  return withClient(extraEnv, async (client) => {
    const { tools } = await client.listTools();
    return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  });
}

async function listTemplatesWithEnv(extraEnv) {
  return withClient(extraEnv, async (client) => {
    const { resourceTemplates } = await client.listResourceTemplates();
    return resourceTemplates.map((template) => template.uriTemplate);
  });
}

describe("Tool schema optionality for org/bucket defaults", () => {
  test("org and bucket are required when no env defaults are set", async () => {
    const tools = await listToolsWithEnv({});

    expect(tools["write-data"].inputSchema.required).toEqual(
      expect.arrayContaining(["org", "bucket", "data"]),
    );
    expect(tools["query-data"].inputSchema.required).toEqual(
      expect.arrayContaining(["org", "query"]),
    );
  });

  test("org and bucket are optional when env defaults are set", async () => {
    const tools = await listToolsWithEnv({
      INFLUXDB_ORG: "default-org",
      INFLUXDB_BUCKET: "default-bucket",
    });

    const writeRequired = tools["write-data"].inputSchema.required;
    expect(writeRequired).toContain("data");
    expect(writeRequired).not.toContain("org");
    expect(writeRequired).not.toContain("bucket");
    expect(tools["write-data"].description).toContain('"default-org"');
    expect(tools["write-data"].description).toContain('"default-bucket"');

    const queryRequired = tools["query-data"].inputSchema.required;
    expect(queryRequired).toContain("query");
    expect(queryRequired).not.toContain("org");
  });

  test("org and bucket optionality is independent", async () => {
    const tools = await listToolsWithEnv({ INFLUXDB_ORG: "default-org" });

    const writeRequired = tools["write-data"].inputSchema.required;
    expect(writeRequired).not.toContain("org");
    expect(writeRequired).toContain("bucket");
  });
});

describe("Capability controls", () => {
  test("all tools carry conservative annotations", async () => {
    const tools = await listToolsWithEnv({});

    expect(Object.keys(tools).sort()).toEqual(["create-bucket", "create-org", "query-data", "write-data"]);
    expect(tools["query-data"].annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    expect(tools["write-data"].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const name of ["create-bucket", "create-org"]) {
      expect(tools[name].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    }
  });

  test("INFLUXDB_READ_ONLY=true registers only query-data", async () => {
    const tools = await listToolsWithEnv({ INFLUXDB_READ_ONLY: "true" });

    expect(Object.keys(tools)).toEqual(["query-data"]);
    expect(tools["query-data"].description).toContain("read-only mode");
  });

  test("the query resource is not registered by default", async () => {
    const templates = await listTemplatesWithEnv({});

    expect(templates).toEqual(["influxdb://bucket/{bucketName}/measurements"]);
  });

  test("INFLUXDB_ENABLE_QUERY_RESOURCE=true registers the query resource", async () => {
    const templates = await listTemplatesWithEnv({ INFLUXDB_ENABLE_QUERY_RESOURCE: "true" });

    expect(templates).toContain("influxdb://query/{orgName}/{fluxQuery}");
  });
});
