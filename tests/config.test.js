import { jest } from "@jest/globals";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseInfluxUrl } from "../src/config/env.js";
import { readSecret } from "../src/config/secrets.js";

jest.setTimeout(20000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "..", "src", "index.js");
const STRONG_TOKEN = "0123456789abcdef0123456789abcdef";

// Run the server with a minimal env and collect stderr until it exits or prints `until`
function runServer(args, env, until) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER_PATH, ...args], {
      env: { PATH: process.env.PATH, ...env },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (until && stderr.includes(until)) child.kill("SIGTERM");
    });
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

const randomPort = () => 39000 + Math.floor(Math.random() * 1000);

describe("parseInfluxUrl", () => {
  test("normalizes the default and trailing slashes", () => {
    expect(parseInfluxUrl("http://localhost:8086")).toBe("http://localhost:8086");
    expect(parseInfluxUrl("https://influx.example.com/")).toBe("https://influx.example.com");
  });

  test("keeps a path prefix", () => {
    expect(parseInfluxUrl("https://proxy.example.com/influx/")).toBe("https://proxy.example.com/influx");
  });

  test.each([
    ["not a url", "not a valid URL"],
    ["ftp://influx.example.com", "http:// or https://"],
    ["file:///etc/passwd", "http:// or https://"],
    ["http://localhost:8086?org=x", "query string or fragment"],
    ["http://localhost:8086/#frag", "query string or fragment"],
    ["http://localhost:8086/?", "query string or fragment"],
  ])("rejects %s", (value, message) => {
    expect(() => parseInfluxUrl(value)).toThrow(message);
  });

  test("rejects credentials without echoing them", () => {
    let error;
    try {
      parseInfluxUrl("https://admin:hunter2@influx.example.com");
    } catch (e) {
      error = e;
    }
    expect(error.message).toContain("must not contain credentials");
    expect(error.message).not.toContain("hunter2");
  });
});

describe("readSecret", () => {
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mcp-secret-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reads the plain variable", () => {
    expect(readSecret({ TOKEN: "abc" }, "TOKEN")).toBe("abc");
    expect(readSecret({}, "TOKEN")).toBeUndefined();
  });

  test("reads and trims the _FILE variant", () => {
    const file = path.join(dir, "token");
    writeFileSync(file, "from-file\n");
    expect(readSecret({ TOKEN_FILE: file }, "TOKEN")).toBe("from-file");
  });

  test("refuses both forms at once", () => {
    expect(() => readSecret({ TOKEN: "a", TOKEN_FILE: "/x" }, "TOKEN")).toThrow("Set only one of TOKEN and TOKEN_FILE");
  });

  test("reports an unreadable file without its contents", () => {
    expect(() => readSecret({ TOKEN_FILE: path.join(dir, "missing") }, "TOKEN")).toThrow(
      "Could not read TOKEN_FILE (ENOENT)",
    );
  });
});

describe("CLI configuration checks", () => {
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mcp-cli-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("requires a token", async () => {
    const { code, stderr } = await runServer(["--http"], {});
    expect(code).toBe(1);
    expect(stderr).toContain("INFLUXDB_TOKEN environment variable is required");
  });

  test("starts with INFLUXDB_TOKEN_FILE and MCP_AUTH_TOKEN_FILE", async () => {
    const influxTokenFile = path.join(dir, "influx-token");
    const authTokenFile = path.join(dir, "auth-token");
    writeFileSync(influxTokenFile, "influx-token\n");
    writeFileSync(authTokenFile, `${STRONG_TOKEN}\n`);
    const port = randomPort();

    const { code, stderr } = await runServer(
      ["--http", String(port)],
      { INFLUXDB_TOKEN_FILE: influxTokenFile, MCP_AUTH_TOKEN_FILE: authTokenFile },
      "listening on",
    );
    expect(stderr).toContain("Authentication: bearer token required");
    expect(code).toBe(0);
  });

  test("refuses INFLUXDB_TOKEN together with INFLUXDB_TOKEN_FILE", async () => {
    const { code, stderr } = await runServer(["--http"], {
      INFLUXDB_TOKEN: "t",
      INFLUXDB_TOKEN_FILE: path.join(dir, "influx-token"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("Set only one of INFLUXDB_TOKEN and INFLUXDB_TOKEN_FILE");
    expect(stderr).not.toContain("is required");
  });

  test("refuses an INFLUXDB_URL with credentials without logging them", async () => {
    const { code, stderr } = await runServer(["--http"], {
      INFLUXDB_TOKEN: "t",
      INFLUXDB_URL: "https://admin:hunter2@influx.example.com",
    });
    expect(code).toBe(1);
    expect(stderr).toContain("INFLUXDB_URL must not contain credentials");
    expect(stderr).not.toContain("hunter2");
  });

  test("refuses an invalid INFLUXDB_MAX_RESPONSE_BYTES", async () => {
    const { code, stderr } = await runServer(["--http"], {
      INFLUXDB_TOKEN: "t",
      INFLUXDB_MAX_RESPONSE_BYTES: "10mb",
    });
    expect(code).toBe(1);
    expect(stderr).toContain("INFLUXDB_MAX_RESPONSE_BYTES must be a positive integer");
  });

  test("warns when the token would travel over plain http to a remote host", async () => {
    const port = randomPort();
    const { stderr } = await runServer(
      ["--http", String(port)],
      { INFLUXDB_TOKEN: "t", INFLUXDB_URL: "http://influx.example.com:8086" },
      "listening on",
    );
    expect(stderr).toContain("the InfluxDB token is sent unencrypted");
  });
});
