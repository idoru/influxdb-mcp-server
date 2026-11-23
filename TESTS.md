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
- `tests/csv-parsing.test.js` covers Flux CSV edge cases in the measurements resource

These run with `npm run test:integration` and need InfluxDB:

- `tests/integration.test.js` writes and queries data directly and through the MCP server over stdio, and lists orgs, buckets and measurements
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

- Each run creates its own bucket, and every bucket or org it creates carries a per-run ID in its name. `afterAll` deletes only those
- MCP server processes started by a test are tracked and stopped by that test

## Running Individual Tests

```bash
# Run a single test by name
npm test -- -t "should list organizations"

# Run one suite
npm test -- tests/http-transport.test.js
```

## Testing Approaches

The project now uses multiple testing approaches to ensure functionality and stability:

1. **Integration Tests** (`tests/integration.test.js`):
   - End-to-end tests against a real InfluxDB instance
   - Tests both direct API calls and MCP client interactions
   - Contains robust cleanup to prevent hanging processes

2. **Direct Handler Tests** (`direct-tests/handlers.test.js`):
   - Tests each handler function directly without MCP protocol overhead
   - Validates that the individual handlers work correctly with InfluxDB
   - Uses environment variable mocking to ensure proper test isolation

3. **Tool Schema Tests** (`tests/tool-schema.test.js`):
   - Spawns the server over stdio with different `INFLUXDB_ORG` / `INFLUXDB_BUCKET` settings and inspects the advertised tool schemas
   - Verifies `org`/`bucket` are only optional when a matching env default is configured
   - Does not require Docker or a running InfluxDB instance

### Direct Testing Advantages

The direct API testing approach focuses on verifying the core functionality without depending on the MCP client. This approach has several advantages:

1. **Isolates Test Concerns**: Separates InfluxDB connectivity testing from MCP client/server communication issues
2. **More Reliable Tests**: Reduces dependency on the MCP client, which can have its own reliability challenges
3. **Better Error Visibility**: Makes it easier to diagnose exactly where issues occur in the stack
4. **Faster Execution**: Direct API calls are typically faster than going through the full MCP stack

For testing server functionality directly, we use:
- Child process spawning with controlled environment variables
- Direct HTTP fetch calls to InfluxDB API endpoints
- Direct imports of the prompt functions to validate prompt content

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

- **Problem**: The MCP client struggles to connect to the server or times out during operations.
- **Solution**:
  - For testing, use the direct API approach implemented in the current tests
  - When MCP client is needed:
    - Check authorization tokens are correct and have sufficient permissions
    - Add proper error handling with detailed logging
    - Implement connection validation and reconnection logic
    - Add appropriate timeout handling using AbortController
    - Consider opening an issue with the MCP SDK if problems persist

#### 3. Test hanging

- **Problem**: Tests hang after showing "Sample data written successfully" with no progress.
- **Solution**:
  - Add detailed logging for each step of the test process
  - Use AbortController with fetch operations to ensure proper cancellation
  - Implement proper error propagation so issues are visible rather than silent
  - Run tests in series with `--runInBand` option to avoid race conditions

#### 4. Leftover test resources

- **Problem**: An interrupted run leaves `test-...-<run id>` buckets or orgs behind on a long-lived instance.
- **Solution**: Delete them by name in the InfluxDB UI or API. The tests only ever delete resources carrying their own run ID, so they will not remove these automatically.

### Advanced Debugging

When tests are failing:

1. Add detailed logging throughout your server implementation
2. Check the test instance: `docker compose -p influxdb-mcp-test ps`
3. View its logs: `docker compose -p influxdb-mcp-test logs influxdb`
4. Run tests with increased verbosity: `npm test -- --verbose`
5. Check if ports are in use: `lsof -i :<port>`
6. Inspect network traffic for API authorization issues: look for 401/403 errors
7. Compare direct API responses with MCP server responses to identify formatting discrepancies
