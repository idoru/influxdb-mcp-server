// Shared setup for the suites that need a real InfluxDB 2.x instance.
//
// The tests never start containers or talk to the Docker API. They use the
// instance described by these variables, which the developer starts
// explicitly (scripts/test-influx.sh) or CI provides as a service container:
//
//   INFLUXDB_TEST_URL          loopback URL, e.g. http://127.0.0.1:8086
//   INFLUXDB_TEST_ADMIN_TOKEN  operator token for that instance
//   INFLUXDB_TEST_ORG          organization created at setup
//
// Without them the suites are skipped, unless REQUIRE_INFLUX_TESTS=1, in which
// case they fail. Everything a run creates carries RUN_ID in its name, and
// cleanup deletes only those resources.
import { randomBytes } from "node:crypto";
import { describe } from "@jest/globals";
import { isLoopbackHost } from "../../src/config/http.js";

const url = process.env.INFLUXDB_TEST_URL?.trim().replace(/\/+$/, "");
const adminToken = process.env.INFLUXDB_TEST_ADMIN_TOKEN;
const org = process.env.INFLUXDB_TEST_ORG;

export const influxConfigured = Boolean(url && adminToken && org);

if (influxConfigured) {
  // The suites write data and create and delete buckets and orgs with an
  // admin token, so never point them at a remote (possibly real) instance
  if (!isLoopbackHost(new URL(url).hostname)) {
    throw new Error("INFLUXDB_TEST_URL must point at a loopback address such as http://127.0.0.1:8086");
  }
} else if (process.env.REQUIRE_INFLUX_TESTS === "1") {
  throw new Error(
    "REQUIRE_INFLUX_TESTS=1 but INFLUXDB_TEST_URL, INFLUXDB_TEST_ADMIN_TOKEN and INFLUXDB_TEST_ORG " +
      "are not all set. Start a test instance with scripts/test-influx.sh.",
  );
}

export const describeInflux = influxConfigured ? describe : describe.skip;

export const influx = { url, adminToken, org };

// Unique per run so concurrent or repeated runs never collide, and cleanup
// can tell this run's resources apart from everything else
export const RUN_ID = randomBytes(4).toString("hex");
export const uniqueName = (label) => `test-${label}-${RUN_ID}`;

// Call the InfluxDB API with the admin token
export function influxApi(path, options = {}) {
  return fetch(`${url}${path}`, {
    ...options,
    headers: {
      Authorization: `Token ${adminToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(10000),
  });
}

async function expectOk(response, what) {
  if (!response.ok) {
    throw new Error(`${what} failed (${response.status}): ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

// Wait until /health reports pass
export async function waitForInfluxDBReady(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.json()).status === "pass") return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`InfluxDB at ${url} did not become healthy within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function getOrgId() {
  const data = await expectOk(await influxApi(`/api/v2/orgs?org=${encodeURIComponent(org)}`), "Org lookup");
  return data.orgs[0].id;
}

// Create a bucket named uniqueName(label) in the test org and return its name
export async function createRunBucket(label) {
  const name = uniqueName(label);
  await expectOk(
    await influxApi("/api/v2/buckets", {
      method: "POST",
      body: JSON.stringify({ name, orgID: await getOrgId() }),
    }),
    `Creating bucket ${name}`,
  );
  return name;
}

// List every item of a paginated collection (buckets or orgs)
async function listAll(kind) {
  const items = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const data = await expectOk(await influxApi(`/api/v2/${kind}?limit=${limit}&offset=${offset}`), `Listing ${kind}`);
    items.push(...data[kind]);
    if (data[kind].length < limit) return items;
  }
}

// Delete the buckets and orgs this run created (names containing RUN_ID).
// Nothing else on the instance is touched.
export async function deleteRunResources() {
  for (const kind of ["buckets", "orgs"]) {
    for (const item of await listAll(kind)) {
      if (!item.name.includes(RUN_ID)) continue;
      const response = await influxApi(`/api/v2/${kind}/${item.id}`, { method: "DELETE" });
      // A bucket may already be gone with its org
      if (!response.ok && response.status !== 404) {
        console.error(`Could not delete ${kind} ${item.name}: ${response.status}`);
      }
    }
  }
}
