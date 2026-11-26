import { jest } from "@jest/globals";
import { REQUEST_OPTIONS, withMcpClient } from "./support/mcp.js";

jest.setTimeout(15000);

// Prompts need no InfluxDB. They are fetched through the server, so the
// tests cover registration as well as content.
const getPrompt = (name) =>
  withMcpClient({ INFLUXDB_TOKEN: "test-token" }, (client) => client.getPrompt({ name }, REQUEST_OPTIONS));

describe("Prompts", () => {
  test("lists both prompts", async () => {
    const { prompts } = await withMcpClient({ INFLUXDB_TOKEN: "test-token" }, (client) =>
      client.listPrompts(undefined, REQUEST_OPTIONS),
    );
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(["flux-query-examples", "line-protocol-guide"]);
  });

  test("flux-query-examples contains Flux examples", async () => {
    const { messages } = await getPrompt("flux-query-examples");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content.text).toContain("from(bucket:");
    expect(messages[0].content.text).toContain("range(start:");
  });

  test("line-protocol-guide explains line protocol", async () => {
    const { messages } = await getPrompt("line-protocol-guide");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content.text).toContain("Line Protocol");
    expect(messages[0].content.text).toContain("measurement,tag-key=tag-value");
  });
});
