import { jest } from "@jest/globals";
import http from "node:http";

jest.setTimeout(10000);

// influxRequest against a local HTTP server that misbehaves on purpose
const MAX_BYTES = 1024;

describe("influxRequest timeouts and limits", () => {
  let influxRequest;
  let server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/headers-hang") return; // never respond
      if (req.url === "/body-hang") {
        res.writeHead(200, { "Content-Type": "text/csv" });
        res.write(",result\r\n"); // never finish the body
        return;
      }
      if (req.url === "/no-content") {
        res.writeHead(204).end();
        return;
      }
      if (req.url === "/exact-limit") {
        res.writeHead(200, { "Content-Type": "text/csv" }).end("x".repeat(MAX_BYTES));
        return;
      }
      if (req.url === "/oversize-declared") {
        res.writeHead(200, { "Content-Length": MAX_BYTES * 4 }).end("x".repeat(MAX_BYTES * 4));
        return;
      }
      if (req.url === "/oversize-endless") {
        // Chunked body that never ends: the size cap must stop reading
        res.writeHead(200, { "Content-Type": "text/csv" });
        const timer = setInterval(() => res.write("y".repeat(256)), 5);
        res.on("close", () => clearInterval(timer));
        return;
      }
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "http://attacker.example/steal" }).end();
        return;
      }
      if (req.url === "/long-error") {
        res.writeHead(500).end("e".repeat(10000));
        return;
      }
      if (req.url === "/reset") {
        req.socket.destroy();
        return;
      }
      res.writeHead(400).end("bad request");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    jest.unstable_mockModule("../src/config/env.js", () => ({
      INFLUXDB_URL: `http://127.0.0.1:${server.address().port}`,
      INFLUXDB_TOKEN: "test-token",
      DEFAULT_ORG: undefined,
      DEFAULT_BUCKET: undefined,
      MAX_RESPONSE_BYTES: MAX_BYTES,
      READ_ONLY: false,
      ENABLE_QUERY_RESOURCE: false,
      validateEnvironment: () => {},
    }));
    ({ influxRequest } = await import("../src/utils/influxClient.js"));
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  test("times out when response headers never arrive", async () => {
    await expect(influxRequest("/headers-hang", {}, 200)).rejects.toThrow("timed out after 200ms");
  });

  test("times out when the response body stalls", async () => {
    const response = await influxRequest("/body-hang", {}, 200);
    await expect(response.text()).rejects.toThrow("timed out after 200ms");
  });

  test("resolves 204 responses without reading a body", async () => {
    const response = await influxRequest("/no-content", { method: "POST" }, 200);
    expect(response.status).toBe(204);
  });

  test("includes the InfluxDB error body in failures", async () => {
    await expect(influxRequest("/bad", {}, 200)).rejects.toThrow("InfluxDB API Error (400): bad request");
  });

  test("reads bodies up to the size limit", async () => {
    const response = await influxRequest("/exact-limit", {}, 2000);
    await expect(response.text()).resolves.toHaveLength(MAX_BYTES);
  });

  test("rejects bodies whose Content-Length exceeds the limit", async () => {
    const response = await influxRequest("/oversize-declared", {}, 2000);
    await expect(response.text()).rejects.toThrow(`InfluxDB response exceeded ${MAX_BYTES} bytes`);
  });

  test("stops reading a streamed body once it exceeds the limit", async () => {
    const response = await influxRequest("/oversize-endless", {}, 5000);
    const started = Date.now();
    await expect(response.json()).rejects.toThrow(`InfluxDB response exceeded ${MAX_BYTES} bytes`);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  test("refuses to follow redirects", async () => {
    await expect(influxRequest("/redirect", {}, 2000)).rejects.toThrow("redirect, which is not followed");
  });

  test("truncates long error bodies", async () => {
    const error = await influxRequest("/long-error", {}, 2000).catch((e) => e);
    expect(error.message).toMatch(/^InfluxDB API Error \(500\): e+ \[truncated\]$/);
    expect(error.message.length).toBeLessThan(2200);
  });

  test("reports connection failures without the InfluxDB URL", async () => {
    const error = await influxRequest("/reset", {}, 2000).catch((e) => e);
    expect(error.message).toMatch(/^Could not reach InfluxDB/);
    expect(error.message).not.toContain("127.0.0.1");
  });
});
