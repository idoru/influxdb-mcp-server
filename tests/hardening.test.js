import { jest } from "@jest/globals";

jest.setTimeout(10000);

// Unit tests for the parsing, escaping and configuration helpers, plus the
// query/measurements resources against a mocked InfluxDB client.
describe("Hardening: helpers and resource handlers", () => {
  let parseCsvRows;
  let parseFluxCsv;
  let fluxString;
  let decodeUriParam;
  let resolveHttpConfig;
  let executeQuery;
  let bucketMeasurements;
  let mockInfluxRequest;

  const csvResponse = (text) => ({ ok: true, status: 200, text: async () => text });

  beforeAll(async () => {
    jest.unstable_mockModule("../src/utils/influxClient.js", () => ({
      influxRequest: jest.fn(),
      DEFAULT_TIMEOUT_MS: 10000,
      WRITE_TIMEOUT_MS: 30000,
      QUERY_TIMEOUT_MS: 60000,
    }));
    jest.unstable_mockModule("../src/config/env.js", () => ({
      INFLUXDB_URL: "http://localhost:8086",
      INFLUXDB_TOKEN: "test-token",
      DEFAULT_ORG: "test-org",
      DEFAULT_BUCKET: undefined,
      validateEnvironment: () => {},
    }));

    ({ parseCsvRows, parseFluxCsv } = await import("../src/utils/csv.js"));
    ({ fluxString, decodeUriParam } = await import("../src/utils/flux.js"));
    ({ resolveHttpConfig } = await import("../src/config/http.js"));
    ({ executeQuery } = await import("../src/handlers/queryHandler.js"));
    ({ bucketMeasurements } = await import("../src/handlers/measurementsHandler.js"));
    ({ influxRequest: mockInfluxRequest } = await import("../src/utils/influxClient.js"));
  });

  beforeEach(() => {
    mockInfluxRequest.mockReset();
  });

  describe("parseCsvRows", () => {
    test("handles CRLF line endings without leaving carriage returns", () => {
      expect(parseCsvRows("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    });

    test("handles quoted fields with commas, quotes and newlines", () => {
      expect(parseCsvRows('a,b\n"x,y","say ""hi""\nthere"\n')).toEqual([
        ["a", "b"],
        ["x,y", 'say "hi"\nthere'],
      ]);
    });

    test("keeps a final row without a trailing newline", () => {
      expect(parseCsvRows("a\n1")).toEqual([["a"], ["1"]]);
    });
  });

  describe("parseFluxCsv", () => {
    test("skips annotations and splits blank-line separated tables", () => {
      const text =
        "#datatype,string,long,double\r\n" +
        ",result,table,_value\r\n" +
        ",_result,0,1.5\r\n" +
        "\r\n" +
        "#datatype,string,long,string\r\n" +
        ",result,table,host\r\n" +
        ",_result,1,server01\r\n";

      const tables = parseFluxCsv(text);
      expect(tables).toHaveLength(2);
      expect(tables[0].headers).toEqual(["", "result", "table", "_value"]);
      expect(tables[0].records).toEqual([{ "": "", result: "_result", table: "0", _value: "1.5" }]);
      expect(tables[1].records[0].host).toBe("server01");
    });

    test("returns no tables for an empty response", () => {
      expect(parseFluxCsv("")).toEqual([]);
      expect(parseFluxCsv("\r\n")).toEqual([]);
    });
  });

  describe("fluxString", () => {
    test("quotes plain values", () => {
      expect(fluxString("my-bucket")).toBe('"my-bucket"');
    });

    test("escapes quotes, backslashes and interpolation", () => {
      expect(fluxString('a"b\\c${d}')).toBe('"a\\"b\\\\c\\${d}"');
    });
  });

  describe("decodeUriParam", () => {
    test("decodes percent-encoding", () => {
      expect(decodeUriParam("x", "my%20org")).toBe("my org");
    });

    test("rejects malformed encoding with a clear error", () => {
      expect(() => decodeUriParam("fluxQuery", "100%")).toThrow("Invalid percent-encoding in fluxQuery");
    });
  });

  describe("resolveHttpConfig", () => {
    test("defaults to loopback with DNS rebinding protection", () => {
      const config = resolveHttpConfig({ http: true }, {});
      expect(config).toMatchObject({
        port: 3000,
        host: "127.0.0.1",
        authToken: undefined,
        allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
        bodyLimit: "4mb",
      });
    });

    test("parses an explicit port", () => {
      expect(resolveHttpConfig({ http: "8080" }, {}).port).toBe(8080);
    });

    test.each(["abc", "0", "65536", "80.5", "-1"])("rejects invalid port %s", (port) => {
      expect(() => resolveHttpConfig({ http: port }, {})).toThrow("Invalid HTTP port");
    });

    test("refuses non-loopback hosts without authentication", () => {
      expect(() => resolveHttpConfig({ http: true, host: "0.0.0.0" }, {})).toThrow(
        /Refusing to listen on non-loopback host/,
      );
    });

    test("allows non-loopback hosts with MCP_AUTH_TOKEN", () => {
      const config = resolveHttpConfig({ http: true }, { MCP_HTTP_HOST: "0.0.0.0", MCP_AUTH_TOKEN: "secret" });
      expect(config.host).toBe("0.0.0.0");
      expect(config.authToken).toBe("secret");
      expect(config.allowedHosts).toBeNull();
    });

    test("allows explicitly unauthenticated non-loopback hosts", () => {
      const config = resolveHttpConfig(
        { http: true, host: "0.0.0.0" },
        { MCP_HTTP_ALLOW_UNAUTHENTICATED: "true" },
      );
      expect(config.allowUnauthenticated).toBe(true);
    });

    test("normalizes MCP_ALLOWED_HOSTS and IPv6 bind hosts", () => {
      const config = resolveHttpConfig(
        { http: true, host: "[::1]" },
        { MCP_ALLOWED_HOSTS: " MCP.example.com , ::1 " },
      );
      expect(config.host).toBe("::1");
      expect(config.allowedHosts).toEqual(["mcp.example.com", "[::1]"]);
    });

    test("rejects body limits body-parser would silently ignore", () => {
      expect(() => resolveHttpConfig({ http: true }, { MCP_HTTP_BODY_LIMIT: "lots" })).toThrow(
        "Invalid MCP_HTTP_BODY_LIMIT",
      );
      expect(resolveHttpConfig({ http: true }, { MCP_HTTP_BODY_LIMIT: "10MB" }).bodyLimit).toBe("10mb");
    });
  });

  describe("query resource", () => {
    test("parses CRLF, annotated, multi-table CSV into clean records", async () => {
      mockInfluxRequest.mockResolvedValueOnce(csvResponse(
        "#datatype,string,long,string,double\r\n" +
          ",result,table,host,_value\r\n" +
          ',_result,0,"server,01",1.5\r\n' +
          "\r\n" +
          "#datatype,string,long,string\r\n" +
          ",result,table,region\r\n" +
          ",_result,1,eu\r\n",
      ));

      const query = 'from(bucket: "b") |> range(start: -1h)';
      const uri = new URL(`influxdb://query/test-org/${encodeURIComponent(query)}`);
      const result = await executeQuery(uri, { orgName: "test-org", fluxQuery: encodeURIComponent(query) });
      const body = JSON.parse(result.contents[0].text);

      expect(result.error).toBeUndefined();
      expect(body.query).toBe(query);
      expect(body.headers).toEqual(["", "result", "table", "host", "_value", "region"]);
      expect(body.data).toEqual([
        { "": "", result: "_result", table: "0", host: "server,01", _value: "1.5" },
        { "": "", result: "_result", table: "1", region: "eu" },
      ]);
    });

    test("decodes the org name instead of double-encoding it", async () => {
      mockInfluxRequest.mockResolvedValueOnce(csvResponse(""));

      const result = await executeQuery(new URL("influxdb://query/my%20org/q"), {
        orgName: "my%20org",
        fluxQuery: "buckets()",
      });

      expect(mockInfluxRequest.mock.calls[0][0]).toBe("/api/v2/query?org=my%20org");
      expect(JSON.parse(result.contents[0].text)).toEqual({ query: "buckets()", organization: "my org", data: [] });
    });

    test("reports malformed query encoding as an error", async () => {
      const result = await executeQuery(new URL("influxdb://query/o/q"), { orgName: "o", fluxQuery: "50%" });
      expect(JSON.parse(result.contents[0].text).error).toContain("Invalid percent-encoding in fluxQuery");
      expect(mockInfluxRequest).not.toHaveBeenCalled();
    });
  });

  describe("measurements resource", () => {
    test("escapes the bucket name inside the Flux query", async () => {
      mockInfluxRequest.mockResolvedValueOnce(csvResponse(",result,table,_value\r\n,,0,cpu\r\n"));

      const bucketName = encodeURIComponent('evil") |> drop() //${x}');
      const result = await bucketMeasurements(new URL(`influxdb://bucket/${bucketName}/measurements`), {
        bucketName,
      });

      const { query } = JSON.parse(mockInfluxRequest.mock.calls[0][1].body);
      expect(query).toContain('schema.measurements(bucket: "evil\\") |> drop() //\\${x}")');
      expect(JSON.parse(result.contents[0].text)).toEqual({
        bucket: 'evil") |> drop() //${x}',
        measurements: ["cpu"],
      });
    });

    test("collects measurements across multiple tables", async () => {
      mockInfluxRequest.mockResolvedValueOnce(csvResponse(
        ",result,table,_value\r\n,,0,cpu\r\n\r\n,result,table,_value\r\n,,1,mem\r\n",
      ));

      const result = await bucketMeasurements(new URL("influxdb://bucket/b/measurements"), { bucketName: "b" });
      expect(JSON.parse(result.contents[0].text).measurements).toEqual(["cpu", "mem"]);
    });
  });
});
