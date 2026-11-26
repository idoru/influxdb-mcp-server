// Shared helpers for tests that run the MCP server as a child process.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const SERVER_PATH = fileURLToPath(new URL("../../src/index.js", import.meta.url));

// Per-request timeout for MCP calls. It is well below Jest's test timeout, so
// a request that never completes fails with the request named in the error.
export const REQUEST_OPTIONS = { timeout: 15000 };

// The environment for a spawned server: PATH plus the given variables only,
// so settings from the developer's shell (DEBUG, INFLUXDB_READ_ONLY, ...)
// cannot change what is tested
export const serverEnv = (env) => ({ PATH: process.env.PATH, ...env });

// Start the server over stdio and run fn against a connected client. The
// server's stderr is collected and printed only if fn fails. The server is
// always stopped, whether fn passes or fails.
export async function withMcpClient(env, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: serverEnv(env),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const client = new Client({ name: "influxdb-mcp-server-tests", version: "1.0.0" });

  try {
    await client.connect(transport, REQUEST_OPTIONS);
    return await fn(client);
  } catch (error) {
    if (stderr.trim()) console.log(`MCP server stderr:\n${stderr.trim()}`);
    throw error;
  } finally {
    await client.close();
  }
}

// Parse the JSON text of a resource read. The resources report failures as
// {"error": ...} with a successful MCP response, so that is checked here.
export function resourceJson(result) {
  const data = JSON.parse(result.contents[0].text);
  if (data.error !== undefined) {
    throw new Error(`Resource returned an error: ${data.error}`);
  }
  return data;
}

// Return the text of a successful tool call; fail with the tool's own message otherwise
export function toolText(result) {
  const text = result.content?.[0]?.text;
  if (result.isError) {
    throw new Error(`Tool returned an error: ${text}`);
  }
  return text;
}

// The ID that create-bucket and create-org report on their "ID: ..." line
export function createdId(text) {
  const id = /^ID: ([0-9a-f]{16})$/m.exec(text)?.[1];
  if (!id) {
    throw new Error(`No 16-character ID in tool reply: ${text}`);
  }
  return id;
}

// Stop a child process this test started and wait until it has exited
export function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  });
}
