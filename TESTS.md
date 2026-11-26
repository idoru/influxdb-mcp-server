# InfluxDB MCP Server Tests

The test suites check the server's handlers, its Streamable HTTP transport and its behaviour against a real InfluxDB 2.x instance.

## Prerequisites

- Node.js 22 or later
- npm
- For the integration suites only: an InfluxDB 2.x instance on a loopback address, or Docker Compose to start one with `scripts/test-influx.sh`

## Setup

```
npm install
```

## Running Tests

```bash
# Suites that need neither Docker nor InfluxDB (the default)
npm test

# Integration suites against a throwaway InfluxDB started with Docker Compose
scripts/test-influx.sh

# Integration suites against an instance you started yourself
INFLUXDB_TEST_URL=http://127.0.0.1:8086 \
INFLUXDB_TEST_ADMIN_TOKEN=... \
INFLUXDB_TEST_ORG=... \
  npm run test:integration

# Everything (the integration suites are skipped unless INFLUXDB_TEST_* is set)
npm run test:all
```

## Suites

These run with `npm test` and need neither Docker nor InfluxDB:

- `tests/hardening.test.js` covers the Flux CSV parser, Flux string escaping, URI parameter decoding, HTTP configuration validation (token length, Origin and Host rules, concurrency), and the query/measurements resources against a mocked InfluxDB client
- `tests/config.test.js` covers `INFLUXDB_URL` validation, `*_FILE` secrets and CLI startup checks
- `tests/influx-client.test.js` checks InfluxDB request timeouts, response size limits, redirect refusal and error reporting against a local misbehaving HTTP server
- `tests/http-transport.test.js` runs the Streamable HTTP app in-process and checks Host and Origin validation, bearer authentication, body and concurrency limits, response headers, the access log, JSON-RPC error responses, concurrent stateless requests, and CLI startup/refusal behaviour
- `tests/tool-schema.test.js` checks advertised tool schemas and annotations, read-only mode and the opt-in query resource
- `tests/prompts.test.js` fetches both prompts through the server and checks their content
- `tests/csv-parsing.test.js` covers Flux CSV edge cases in the measurements resource

These run with `npm run test:integration` and need InfluxDB:

- `tests/integration.test.js` runs the MCP server over stdio, through the SDK client and with raw JSON-RPC, and checks every tool and resource against the InfluxDB API, which it also exercises directly as a baseline
- `direct-tests/handlers.test.js` calls each resource and tool handler directly

## Test Environment

The integration suites read the instance from:

- `INFLUXDB_TEST_URL`: loopback URL such as `http://127.0.0.1:8086`. Remote URLs are refused, because the suites write data and create and delete buckets and orgs with an admin token
- `INFLUXDB_TEST_ADMIN_TOKEN`: operator token for that instance
- `INFLUXDB_TEST_ORG`: organization created at setup

Without these variables the suites are skipped. Set `REQUIRE_INFLUX_TESTS=1` (as CI does) to make that a failure instead.

`scripts/test-influx.sh` starts `docker-compose.test.yml` as the `influxdb-mcp-test` Compose project: a digest-pinned `influxdb:2.7`, published on `127.0.0.1` only, with random credentials and data on tmpfs. It removes that project when the run ends. In CI the same image runs as a GitHub Actions service container.

## Cleanup

The tests never use the Docker API and never stop, kill or remove anything they did not create:

- Each run creates its own bucket, and every bucket or org it creates carries a per-run ID in its name. `afterAll` deletes only those, and fails the suite if any deletion fails
- MCP server processes started by a test are stopped by that test

## Running Individual Tests

```bash
# Run a single test by name
npm test -- -t "should list organizations"

# Run one suite
npm test -- tests/http-transport.test.js

# Run a single integration test against a throwaway InfluxDB
scripts/test-influx.sh -t "should list buckets - MCP client"
```

Every test can run on its own: the integration suites write their sample data in `beforeAll`.

## Testing Approaches

1. **Integration tests** (`tests/integration.test.js`):
   - Run the MCP server over stdio against a real InfluxDB, through the SDK client, and once with raw newline-delimited JSON-RPC, which also checks that stdout carries nothing but JSON-RPC
   - Verify each tool's effect through the InfluxDB API, by the ID the tool reports where it reports one
   - Exercise the InfluxDB API directly as a baseline, so a failure points at either the server or the instance

2. **Direct handler tests** (`direct-tests/handlers.test.js`):
   - Call each handler function directly, without the MCP protocol, with `src/config/env.js` mocked

3. **Tool schema and prompt tests** (`tests/tool-schema.test.js`, `tests/prompts.test.js`):
   - Spawn the server over stdio and inspect the advertised tools, resources and prompts
   - Need neither Docker nor InfluxDB

## Writing Tests

A test must fail whenever the behaviour it names is broken:

- No fallbacks, retries or conditional assertions. An MCP test never falls back to the InfluxDB API, and never skips an assertion because a result has an unexpected shape.
- Tool results carry `isError`, not `error`. Read them with `toolText()` from `tests/support/mcp.js`, which fails on `isError`, and assert the exact reply. Read resources with `resourceJson()`, which fails when the resource reports an `error`.
- Check side effects through the InfluxDB API by ID or name filter, not by scanning the first page of a list.
- Start servers with `withMcpClient()`. It passes only `PATH` and the variables the test gives, so shell settings such as `DEBUG` or `INFLUXDB_READ_ONLY` cannot change the result. It prints the server's stderr only when the test fails, and always stops the server.
- `tests/support/console-guard.js` fails any test that logs to `console.error` or `console.warn`. A test that expects such a message takes it with `takeConsoleCalls()` from `tests/support/console.js` and asserts on it.

## Troubleshooting Guide

### Current Status

- All tests are now passing
- Previous issues with list operations timing out have been resolved
- The integration tests now correctly validate both direct API access and MCP server functionality

### Lessons Learned from Testing Issues

During development, we encountered several challenges with testing the MCP server:

#### 1. MCP Protocol Compatibility Issues

- **Problem**: The MCP client and server had compatibility issues with method names and protocol implementation.
- **Solution**: Created direct handler tests that bypass the MCP protocol to validate core functionality independently of protocol issues.

#### 2. Authentication Token Mismatch

- **Problem**: The MCP server was using the regular token (INFLUXDB_TOKEN) instead of the admin token (INFLUXDB_ADMIN_TOKEN) when making API calls, resulting in 401 unauthorized errors.
- **Solution**: Updated the tests to use the admin token for all operations, ensuring proper authorization.

#### 3. Multiple Server Process Conflicts

- **Problem**: The test suite was creating two instances of the server process - one explicitly and another through the StdioClientTransport, causing conflicts and connection issues.
- **Solution**: Restructured the tests to either use direct API calls or properly manage a single server process instance.

#### 4. Environment Variable Persistence

- **Problem**: Environment variables set during runtime were not affecting already-imported modules that had cached the values.
- **Solution**: Implemented Jest module mocking to override environment configuration during testing.

#### 5. Inadequate Request Timeout Handling

- **Problem**: The promise race used for timeouts wasn't properly canceling fetch operations when timeouts occurred, leading to dangling network requests.
- **Solution**: Implemented AbortController for proper request cancellation in the influxRequest function.

### Common Issues and Solutions

#### 1. Port conflicts

- **Problem**: `scripts/test-influx.sh` cannot publish InfluxDB because port 8086 is already in use.
- **Solution**: Run it with another port, e.g. `INFLUXDB_TEST_PORT=18086 scripts/test-influx.sh`. If an earlier run was interrupted, remove only its project with `docker compose -p influxdb-mcp-test down --volumes`.

#### 2. MCP client connection issues

- **Problem**: An MCP test fails to connect to the server, or a request fails.
- **Solution**:
  - Read the server stderr printed above the failure; it usually names the cause, such as a refused configuration or an InfluxDB error
  - Check that the token is correct and has sufficient permissions
  - Reproduce by running `node src/index.js` with the same variables
  - Do not add retries or fall back to the InfluxDB API: the test must fail when the server does

#### 3. Test hanging

- **Problem**: A test makes no progress.
- **Solution**:
  - MCP requests in tests time out after 15 seconds (`REQUEST_OPTIONS` in `tests/support/mcp.js`) and InfluxDB API calls after 10 seconds, each with an error naming the request
  - Run tests in series with `--runInBand` (the npm scripts already do) to avoid race conditions

#### 4. Leftover test resources

- **Problem**: An interrupted run leaves `test-...-<run id>` buckets or orgs behind on a long-lived instance.
- **Solution**: Delete them by name in the InfluxDB UI or API. The tests only ever delete resources carrying their own run ID, so they will not remove these automatically.

### Advanced Debugging

When tests are failing:

1. Run the server by hand with `DEBUG=mcp:*` to see full MCP messages. Never enable it in tests or by default: it logs query text and written data
2. Check the test instance: `docker compose -p influxdb-mcp-test ps`
3. View its logs: `docker compose -p influxdb-mcp-test logs influxdb`
4. Run tests with increased verbosity: `npm test -- --verbose`
5. Check if ports are in use: `lsof -i :<port>`
6. Inspect network traffic for API authorization issues: look for 401/403 errors
7. Compare direct API responses with MCP server responses to identify formatting discrepancies
