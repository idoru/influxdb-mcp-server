# InfluxDB MCP Server Integration Tests

This directory contains a comprehensive integration test suite for the InfluxDB MCP Server. The tests verify that the server correctly interacts with an InfluxDB instance and exposes all the functionality through the Model Context Protocol.

## Prerequisites

- Node.js 20 or higher
- Docker (for running InfluxDB during tests)
- npm or yarn

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Make sure Docker is running on your system

## Running Tests

To run the integration tests:

```
npm test
```

## What the Tests Cover

The test suite:

1. Starts an InfluxDB 2.7 container in Docker
2. Initializes the database with an organization, bucket, and authentication token
3. Tests core InfluxDB connectivity directly:
   - Writing data to InfluxDB
   - Listing organizations and buckets
   - Querying measurements in a bucket
   - Creating new buckets
4. Tests InfluxDB MCP Server functionality:
   - Direct server process communication
   - Testing write-data operations
   - Testing Flux queries
   - Verifying prompt content and validity

Three suites run without Docker:

- `tests/hardening.test.js` covers the Flux CSV parser, Flux string escaping, URI parameter decoding, HTTP configuration validation, and the query/measurements resources against a mocked InfluxDB client
- `tests/influx-client.test.js` checks InfluxDB request timeouts (stalled headers and stalled bodies) against a local misbehaving HTTP server
- `tests/http-transport.test.js` runs the Streamable HTTP app in-process and checks Host header validation (DNS rebinding), bearer authentication, body limits, JSON-RPC error responses, concurrent stateless requests, and CLI startup/refusal behaviour

Run them alone with `npm test -- tests/hardening.test.js tests/http-transport.test.js tests/influx-client.test.js`.

## Test Environment

The tests use the following configuration:

- InfluxDB running on port 8086
- A test organization named "test-org"
- A test bucket named "test-bucket"
- A test admin token and a separate token for the MCP server

## Automatic Cleanup

After the tests complete, the suite:

1. Cleans up any spawned server processes
2. Stops and removes the InfluxDB Docker container
3. Performs additional cleanup of any leftover Docker containers

## Note on Docker Usage

The integration tests require Docker to be installed and running on your system. Make sure you have proper permissions to create and manage Docker containers before running the tests.

## Running Individual Tests

You can run specific tests to isolate issues:

```bash
# Run a single test by name
npm test -- -t "should list organizations"

# Skip integration tests
npm test -- --testPathIgnorePatterns=integration.test.js
```

## Testing Approaches

The project now uses multiple testing approaches to ensure functionality and stability:

1. **Integration Tests** (`tests/integration.test.js`):
   - End-to-end tests that use Docker to run a real InfluxDB instance
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
- Code scanning to validate prompt content

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

- **Problem**: "Port is already allocated" errors occur when Docker tries to start InfluxDB on a port already in use.
- **Solution**:
  - Use a randomized port for InfluxDB containers to avoid conflicts (implemented)
  - Clean up any lingering Docker containers using `docker ps -a` and `docker rm`

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

#### 4. Docker resource cleanup

- **Problem**: Docker containers aren't properly cleaned up, leading to resource leaks.
- **Solution**:
  - Implement a robust `afterAll()` that cleans up all resources regardless of test success/failure
  - Add container ID logging for better debugging
  - Forcefully remove any leftover test containers

### Advanced Debugging

When tests are failing:

1. Add detailed logging throughout your server implementation
2. Check Docker container status: `docker ps -a`
3. View detailed logs from containers: `docker logs <container-id>`
4. Run tests with increased verbosity: `npm test -- --verbose`
5. Check if ports are in use: `lsof -i :<port>`
6. Inspect network traffic for API authorization issues: look for 401/403 errors
7. Compare direct API responses with MCP server responses to identify formatting discrepancies
