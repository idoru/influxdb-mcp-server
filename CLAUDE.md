# InfluxDB MCP Server - Guide for Claude

## Build & Test Commands
- **Run all tests**: `npm test`
- **Run a single test**: `npm test -- -t "test name"` (e.g., `npm test -- -t "should list organizations"`)
- **Skip integration tests**: `npm test -- --testPathIgnorePatterns=integration.test.js`
- **Install dependencies**: `npm install`
- **Start server**: `INFLUXDB_TOKEN=your_token node src/index.js`
- **Test with Docker**: Make sure Docker is running before executing tests
- **Debug tests**: Add `DEBUG=mcp:*` environment variable for detailed MCP protocol logging

## Code Style Guidelines
- **Language**: ES Modules JavaScript with TypeScript types (file extensions: .js)
- **Testing**: Jest with 60-second timeout for Docker operations
- **Formatting**: 2-space indentation
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Types**: Zod for runtime type validation
- **Error handling**: Try/catch blocks with structured error messages
- **Imports**: ES modules with named imports
- **Async patterns**: Async/await pattern preferred over promises

## Environment
- **Required vars**: `INFLUXDB_TOKEN` (authentication)
- **Optional vars**: 
  - `INFLUXDB_URL` (defaults to http://localhost:8086)
  - `INFLUXDB_ORG` (organization name for queries)
  - `INFLUXDB_BUCKET` (default bucket for write-data)
  - `DEBUG=mcp:*` (enables MCP protocol debugging; logs full messages including data)
- **HTTP transport vars** (`--http` only):
  - `MCP_HTTP_HOST` (bind interface, defaults to 127.0.0.1; same as `--host`)
  - `MCP_AUTH_TOKEN` (require `Authorization: Bearer`; mandatory for non-loopback hosts)
  - `MCP_ALLOWED_HOSTS` (comma-separated Host header allowlist)
  - `MCP_HTTP_ALLOW_UNAUTHENTICATED=true` (opt out of the auth requirement off loopback)
  - `MCP_HTTP_BODY_LIMIT` (defaults to 4mb)

## Project Structure
- `src/index.js` - CLI entry point; `src/server.js` - MCP server factory
- `src/http/app.js` - Express app for Streamable HTTP (Host validation, auth, limits)
- `src/config/` - `env.js` (InfluxDB env) and `http.js` (HTTP transport options)
- `src/utils/` - InfluxDB client, Flux CSV parser, Flux escaping, logging
- `tests/` - Integration tests using Docker containers, plus Docker-free unit/HTTP tests
- `direct-tests/` - Handler tests against a Dockerized InfluxDB

## Testing Approach
- Integration tests use Docker to spin up a real InfluxDB instance
- Tests primarily use direct API communication for reliability
- Server process is tested through direct spawning and API verification
- All tests include proper cleanup of Docker containers
- Test timeout is set to 60 seconds to accommodate Docker operations
- Tests mock `src/config/env.js` and `src/utils/influxClient.js` with explicit export lists; update those mocks when adding exports that handlers import
- Interpolate user values into Flux only via `fluxString()`, and route InfluxDB calls through `influxRequest()` so timeouts apply

## Common Issues
- Docker needs to be running for tests to pass
- Port conflicts can occur if other services are using port 8086
- MCP client connection issues are bypassed by using direct API testing
- Sometimes Docker cleanup requires manual intervention (docker rm)
- See TESTS.md for detailed troubleshooting guides