import { jest } from "@jest/globals";
import http from "node:http";

jest.setTimeout(10000);

// influxRequest against a local HTTP server that misbehaves on purpose
describe("influxRequest timeouts", () => {
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
      res.writeHead(400).end("bad request");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    jest.unstable_mockModule("../src/config/env.js", () => ({
      INFLUXDB_URL: `http://127.0.0.1:${server.address().port}`,
      INFLUXDB_TOKEN: "test-token",
      DEFAULT_ORG: undefined,
      DEFAULT_BUCKET: undefined,
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
});
