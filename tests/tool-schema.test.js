import { jest } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

jest.setTimeout(15000);

// Spawn the server over stdio with the given env and return its tool list.
// No InfluxDB instance is needed: listing tools never hits the API.
async function listToolsWithEnv(extraEnv) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/index.js"],
    env: {
      PATH: process.env.PATH,
      INFLUXDB_TOKEN: "test-token",
      ...extraEnv,
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "schema-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  } finally {
    await client.close();
  }
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
