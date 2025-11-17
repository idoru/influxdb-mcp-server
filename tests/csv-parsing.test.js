import { jest } from "@jest/globals";

// Test timeout
jest.setTimeout(10000);

describe("CSV Parsing Edge Cases - Issue #8", () => {
  let bucketMeasurements;
  let mockInfluxRequest;

  beforeAll(async () => {
    // Mock the influxClient module before importing the handler
    jest.unstable_mockModule("../src/utils/influxClient.js", () => ({
      influxRequest: jest.fn(),
    }));

    // Mock the env module
    jest.unstable_mockModule("../src/config/env.js", () => ({
      INFLUXDB_URL: "http://localhost:8086",
      INFLUXDB_TOKEN: "test-token",
      DEFAULT_ORG: "test-org",
      validateEnvironment: () => {},
    }));

    // Import the handler after mocking
    const measurementsHandler = await import(
      "../src/handlers/measurementsHandler.js"
    );
    bucketMeasurements = measurementsHandler.bucketMeasurements;

    // Get reference to the mocked function
    const influxClient = await import("../src/utils/influxClient.js");
    mockInfluxRequest = influxClient.influxRequest;
  });

  test("should handle CSV with Flux metadata rows (Issue #8)", async () => {
    console.log(
      "Testing CSV parsing with Flux metadata rows - reproducing Issue #8",
    );

    // This CSV response reproduces the exact issue from #8:
    // - Flux metadata rows starting with # appear before the header row
    // - Without the fix, the code would try to parse line[0] (a metadata row)
    //   as the header, causing indexOf("_value") to return -1
    const problematicCsvResponse =
      "#datatype,string,long,string\n" +
      "#group,false,false,false\n" +
      "#default,_result,,\n" +
      ",result,table,_value\n" +
      ",,0,cpu_usage\n" +
      ",,0,temperature\n" +
      ",,0,memory_usage\n";

    // Mock the influxRequest to return this problematic CSV
    mockInfluxRequest.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => problematicCsvResponse,
    });

    // Call the handler
    const uri = new URL("influxdb://bucket/test-bucket/measurements");
    const params = { bucketName: "test-bucket" };

    const response = await bucketMeasurements(uri, params);

    // Verify the response
    expect(response).toBeDefined();
    expect(response.contents).toBeDefined();
    expect(response.contents[0]).toBeDefined();
    expect(response.contents[0].text).toBeDefined();

    // Parse the JSON response
    const result = JSON.parse(response.contents[0].text);

    // Validate measurements were correctly extracted
    expect(result.measurements).toBeDefined();
    expect(Array.isArray(result.measurements)).toBe(true);
    expect(result.measurements).toHaveLength(3);
    expect(result.measurements).toContain("cpu_usage");
    expect(result.measurements).toContain("temperature");
    expect(result.measurements).toContain("memory_usage");

    console.log("✓ Successfully parsed CSV by filtering metadata rows");
  });

  test("should trim whitespace from header names", async () => {
    console.log("Testing CSV parsing with whitespace in headers");

    // CSV with whitespace in header names (though uncommon, the fix handles it)
    const csvWithWhitespace =
      "#datatype,string,long,string\n" +
      ", result , table , _value \n" +
      ",,0,disk_usage\n" +
      ",,0,network_traffic\n";

    mockInfluxRequest.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => csvWithWhitespace,
    });

    const uri = new URL("influxdb://bucket/test-bucket/measurements");
    const params = { bucketName: "test-bucket" };

    const response = await bucketMeasurements(uri, params);
    const result = JSON.parse(response.contents[0].text);

    expect(result.measurements).toHaveLength(2);
    expect(result.measurements).toContain("disk_usage");
    expect(result.measurements).toContain("network_traffic");

    console.log("✓ Successfully parsed CSV with whitespace in headers");
  });

  test("should handle CSV with extensive metadata rows", async () => {
    console.log("Testing CSV parsing with extensive metadata");

    // CSV with many metadata rows (all starting with #)
    const csvWithMetadata =
      "#datatype,string,long,string\r\n" +
      "#group,false,false,false\r\n" +
      "#default,_result,,\r\n" +
      "# This is a comment\r\n" +
      "#another,metadata,row\r\n" +
      ",result,table,_value\r\n" +
      ",,0,sensor_data\r\n";

    mockInfluxRequest.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => csvWithMetadata,
    });

    const uri = new URL("influxdb://bucket/test-bucket/measurements");
    const params = { bucketName: "test-bucket" };

    const response = await bucketMeasurements(uri, params);
    const result = JSON.parse(response.contents[0].text);

    expect(result.measurements).toHaveLength(1);
    expect(result.measurements).toContain("sensor_data");

    console.log("✓ Successfully filtered metadata rows");
  });

  test("should handle empty CSV response", async () => {
    console.log("Testing CSV parsing with empty response");

    // CSV with only metadata, no data rows
    const emptyCsv =
      "#datatype,string,long,string\r\n" +
      "#group,false,false,false\r\n";

    mockInfluxRequest.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => emptyCsv,
    });

    const uri = new URL("influxdb://bucket/test-bucket/measurements");
    const params = { bucketName: "test-bucket" };

    const response = await bucketMeasurements(uri, params);
    const result = JSON.parse(response.contents[0].text);

    expect(result.measurements).toBeDefined();
    expect(Array.isArray(result.measurements)).toBe(true);
    expect(result.measurements).toHaveLength(0);

    console.log("✓ Successfully handled empty CSV");
  });

  test("should handle CSV with missing _value column", async () => {
    console.log("Testing CSV parsing without _value column");

    // CSV without the _value column
    const csvWithoutValue =
      ",result,table,measurement\r\n" +
      ",,0,cpu_usage\r\n";

    mockInfluxRequest.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => csvWithoutValue,
    });

    const uri = new URL("influxdb://bucket/test-bucket/measurements");
    const params = { bucketName: "test-bucket" };

    const response = await bucketMeasurements(uri, params);
    const result = JSON.parse(response.contents[0].text);

    // Should return empty array when _value column is missing
    expect(result.measurements).toBeDefined();
    expect(Array.isArray(result.measurements)).toBe(true);
    expect(result.measurements).toHaveLength(0);

    console.log("✓ Successfully handled missing _value column");
  });

  test("should handle CSV with values containing whitespace", async () => {
    console.log("Testing CSV parsing with whitespace in values");

    // CSV with whitespace in the actual measurement values
    const csvWithValueWhitespace =
      ",result,table,_value\r\n" +
      ",,0, cpu_usage \r\n" +
      ",,0,  temperature  \r\n" +
      ",,0,memory_usage   \r\n";

    mockInfluxRequest.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => csvWithValueWhitespace,
    });

    const uri = new URL("influxdb://bucket/test-bucket/measurements");
    const params = { bucketName: "test-bucket" };

    const response = await bucketMeasurements(uri, params);
    const result = JSON.parse(response.contents[0].text);

    // Values should be trimmed
    expect(result.measurements).toHaveLength(3);
    expect(result.measurements).toContain("cpu_usage");
    expect(result.measurements).toContain("temperature");
    expect(result.measurements).toContain("memory_usage");

    // Verify no whitespace remains
    result.measurements.forEach((m) => {
      expect(m).toBe(m.trim());
    });

    console.log("✓ Successfully trimmed whitespace from values");
  });
});
