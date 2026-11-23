import { jest } from "@jest/globals";
import http from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

jest.setTimeout(20000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "..", "src", "index.js");
const { version } = createRequire(import.meta.url)("../package.json");

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "http-transport-test", version: "1.0.0" },
  },
};

// Raw HTTP request so tests can control the Host header (fetch does not allow it)
function request(port, { method = "POST", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method,
        headers: {
          Host: `localhost:${port}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(payload === undefined ? {} : { "Content-Length": Buffer.byteLength(payload) }),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

// Responses may be plain JSON or a single SSE "message" event
function parseRpc(text) {
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine ? dataLine.slice("data: ".length) : text);
}

describe("HTTP transport hardening", () => {
  let createHttpApp;
  let createMcpServer;
  let resolveHttpConfig;
  const servers = [];

  async function listen(config) {
    const app = createHttpApp({ createMcpServer, bodyLimit: "4mb", allowedHosts: null, ...config });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    servers.push(server);
    return server.address().port;
  }

  beforeAll(async () => {
    ({ createHttpApp } = await import("../src/http/app.js"));
    ({ createMcpServer } = await import("../src/server.js"));
    ({ resolveHttpConfig } = await import("../src/config/http.js"));
  });

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  });

  describe("DNS rebinding protection", () => {
    let port;

    beforeAll(async () => {
      port = await listen({ allowedHosts: ["localhost", "127.0.0.1", "[::1]"] });
    });

    test("serves requests with an allowed Host header", async () => {
      const res = await request(port, { body: INITIALIZE });
      expect(res.status).toBe(200);
      const rpc = parseRpc(res.text);
      expect(rpc.result.serverInfo).toEqual({ name: "InfluxDB", version });
    });

    test("rejects a rebound Host header", async () => {
      const res = await request(port, { body: INITIALIZE, headers: { Host: `attacker.example:${port}` } });
      expect(res.status).toBe(403);
      expect(JSON.parse(res.text).error.message).toContain("Invalid Host");
    });

    test("checks the Host header before parsing the body", async () => {
      const res = await request(port, { body: "{not json", headers: { Host: `attacker.example:${port}` } });
      expect(res.status).toBe(403);
    });

    test("accepts the configured loopback address as Host by default", async () => {
      // Listen on 127.0.0.1 (other 127/8 addresses may not be configured on the
      // test machine) but resolve the allowlist as if --host 127.0.0.2 was given
      const { allowedHosts } = resolveHttpConfig({ http: true, host: "127.0.0.2" }, {});
      const altPort = await listen({ allowedHosts });
      const res = await request(altPort, { body: INITIALIZE, headers: { Host: `127.0.0.2:${altPort}` } });
      expect(res.status).toBe(200);
    });

    test("accepts the IPv6 loopback Host", async () => {
      const res = await request(port, { body: INITIALIZE, headers: { Host: `[::1]:${port}` } });
      expect(res.status).toBe(200);
    });
  });

  describe("bearer authentication", () => {
    let port;

    beforeAll(async () => {
      port = await listen({ authToken: "s3cret-token" });
    });

    test("rejects requests without a token", async () => {
      const res = await request(port, { body: INITIALIZE });
      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toContain("Bearer");
    });

    test("checks the token before parsing the body", async () => {
      const res = await request(port, { body: "{not json" });
      expect(res.status).toBe(401);
    });

    test("rejects non-Bearer schemes", async () => {
      const res = await request(port, { body: INITIALIZE, headers: { Authorization: "Basic s3cret-token" } });
      expect(res.status).toBe(401);
    });

    test("requires the token for GET as well", async () => {
      const res = await request(port, { method: "GET" });
      expect(res.status).toBe(401);
    });

    test("rejects requests with the wrong token", async () => {
      const res = await request(port, { body: INITIALIZE, headers: { Authorization: "Bearer wrong" } });
      expect(res.status).toBe(401);
    });

    test("accepts requests with the correct token", async () => {
      const res = await request(port, { body: INITIALIZE, headers: { Authorization: "Bearer s3cret-token" } });
      expect(res.status).toBe(200);
      expect(parseRpc(res.text).result.serverInfo.name).toBe("InfluxDB");
    });
  });

  describe("Origin validation", () => {
    let port;
    let authedPort;

    beforeAll(async () => {
      port = await listen({ allowedOrigins: ["https://app.example.com"] });
      authedPort = await listen({ allowedOrigins: [], authToken: "s3cret-token" });
    });

    test("serves native clients that send no Origin", async () => {
      const res = await request(port, { body: INITIALIZE });
      expect(res.status).toBe(200);
    });

    test("rejects a foreign Origin", async () => {
      const res = await request(port, { body: INITIALIZE, headers: { Origin: "https://evil.example" } });
      expect(res.status).toBe(403);
      expect(JSON.parse(res.text).error.message).toContain("Origin not allowed");
    });

    test("rejects the opaque null Origin", async () => {
      const res = await request(port, { body: INITIALIZE, headers: { Origin: "null" } });
      expect(res.status).toBe(403);
    });

    test("accepts an allowed Origin case-insensitively", async () => {
      const res = await request(port, { body: INITIALIZE, headers: { Origin: "https://APP.example.com" } });
      expect(res.status).toBe(200);
    });

    test("checks Origin before authentication and body parsing", async () => {
      const res = await request(authedPort, { body: "{not json", headers: { Origin: "https://evil.example" } });
      expect(res.status).toBe(403);
    });
  });

  describe("concurrency limit", () => {
    test("answers 503 with Retry-After once the limit is reached", async () => {
      let entered;
      const handlerEntered = new Promise((resolve) => (entered = resolve));
      // A server whose connect() never settles holds its request slot open
      const stalledServer = () => ({
        connect: () => {
          entered();
          return new Promise(() => {});
        },
        close: async () => {},
      });
      const app = createHttpApp({
        createMcpServer: stalledServer,
        bodyLimit: "4mb",
        allowedHosts: null,
        maxConcurrent: 1,
      });
      const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      servers.push(server);
      const port = server.address().port;

      const payload = JSON.stringify(INITIALIZE);
      const held = http.request({
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          Host: `localhost:${port}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(payload),
        },
      });
      held.on("error", () => {});
      held.end(payload);
      await handlerEntered;

      const res = await request(port, { body: INITIALIZE });
      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("1");

      held.destroy();
    });
  });

  describe("response headers and access log", () => {
    let port;

    beforeAll(async () => {
      port = await listen({});
    });

    test("sets nosniff and no-store", async () => {
      const res = await request(port, { method: "GET" });
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    test("keeps no-store on MCP responses the SDK writes itself", async () => {
      const res = await request(port, { body: INITIALIZE });
      expect(res.status).toBe(200);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cache-control"]).toMatch(/(^|,\s*)no-store(,|$)/);
      expect(parseRpc(res.text).result.serverInfo.name).toBe("InfluxDB");
    });

    test("logs the tool name but never its arguments", async () => {
      const lines = [];
      const spy = jest.spyOn(console, "log").mockImplementation((...args) => lines.push(args.join(" ")));
      try {
        await request(port, {
          body: {
            jsonrpc: "2.0",
            id: 7,
            method: "tools/call",
            params: { name: "no-such-tool\nforged line", arguments: { query: "SECRET-MARKER" } },
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      } finally {
        spy.mockRestore();
      }
      const access = lines.filter((line) => line.startsWith("HTTP POST /mcp"));
      expect(access).toHaveLength(1);
      expect(access[0]).toMatch(/ 200 \d+ms client=\S+ rpc=tools\/call:no-such-tool\?forged line$/);
      expect(lines.join("\n")).not.toContain("SECRET-MARKER");
    });
  });

  describe("request handling", () => {
    let port;

    beforeAll(async () => {
      port = await listen({ bodyLimit: "1kb" });
    });

    test("returns a JSON-RPC error for oversized bodies", async () => {
      const res = await request(port, { body: { ...INITIALIZE, padding: "x".repeat(2048) } });
      expect(res.status).toBe(413);
      expect(JSON.parse(res.text).error.code).toBe(-32600);
    });

    test("returns a JSON-RPC parse error for malformed JSON", async () => {
      const res = await request(port, { body: "{not json" });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.text).error.code).toBe(-32700);
    });

    test.each(["GET", "DELETE"])("answers %s with 405 and an Allow header", async (method) => {
      const res = await request(port, { method });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("POST");
    });

    test("isolates concurrent stateless requests", async () => {
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          request(port, { body: { jsonrpc: "2.0", id: i + 100, method: "tools/list", params: {} } }),
        ),
      );

      responses.forEach((res, i) => {
        expect(res.status).toBe(200);
        const rpc = parseRpc(res.text);
        expect(rpc.id).toBe(i + 100);
        expect(rpc.result.tools.map((t) => t.name).sort()).toEqual(
          ["create-bucket", "create-org", "query-data", "write-data"],
        );
      });
    });

    test("rejects a malformed orgID before calling InfluxDB", async () => {
      const res = await request(port, {
        body: {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "create-bucket", arguments: { name: "b", orgID: "../../api/v2/orgs" } },
        },
      });
      const rpc = parseRpc(res.text);
      const message = rpc.error?.message ?? rpc.result.content[0].text;
      expect(rpc.error || rpc.result.isError).toBeTruthy();
      expect(message).toContain("16-character hexadecimal");
    });

    test("advertises create-bucket retention as a non-negative integer", async () => {
      const res = await request(port, { body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
      const tool = parseRpc(res.text).result.tools.find((t) => t.name === "create-bucket");
      expect(tool.inputSchema.properties.retentionPeriodSeconds).toMatchObject({ type: "integer", minimum: 0 });
    });
  });

  describe("CLI startup", () => {
    // Run the server and collect its stderr until it exits or prints `until`
    function runServer(args, env = {}, until) {
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [SERVER_PATH, ...args], {
          env: { PATH: process.env.PATH, INFLUXDB_TOKEN: "test-token", ...env },
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
          if (until && stderr.includes(until)) child.kill("SIGTERM");
        });
        child.on("exit", (code) => resolve({ code, stderr }));
      });
    }

    test("rejects an invalid port", async () => {
      const { code, stderr } = await runServer(["--http", "abc"]);
      expect(code).toBe(1);
      expect(stderr).toContain('Invalid HTTP port "abc"');
    });

    test("refuses a malformed boolean flag instead of ignoring it", async () => {
      const { code, stderr } = await runServer(["--http"], { INFLUXDB_READ_ONLY: "1" });
      expect(code).toBe(1);
      expect(stderr).toContain('INFLUXDB_READ_ONLY must be "true" or "false"');
    });

    test("refuses to listen on all interfaces without authentication", async () => {
      const { code, stderr } = await runServer(["--http", "--host", "0.0.0.0"]);
      expect(code).toBe(1);
      expect(stderr).toContain("Refusing to listen on non-loopback host");
    });

    test("listens on loopback by default and exits cleanly on SIGTERM", async () => {
      const port = 39000 + Math.floor(Math.random() * 1000);
      const { code, stderr } = await runServer(["--http", String(port)], {}, "listening on");
      expect(stderr).toContain(`listening on http://127.0.0.1:${port}/mcp`);
      expect(stderr).toContain("Host header validation: localhost, 127.0.0.1, [::1]");
      expect(code).toBe(0);
    });
  });
});
