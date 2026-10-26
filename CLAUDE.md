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
  - `DEBUG=mcp:*` (enables MCP protocol debugging)

## Project Structure
- `src/` - Core server implementation
- `tests/` - Integration tests using Docker containers

## Testing Approach
- Integration tests use Docker to spin up a real InfluxDB instance
- Tests primarily use direct API communication for reliability
- Server process is tested through direct spawning and API verification
- All tests include proper cleanup of Docker containers
- Test timeout is set to 60 seconds to accommodate Docker operations

## Common Issues
- Docker needs to be running for tests to pass
- Port conflicts can occur if other services are using port 8086
- MCP client connection issues are bypassed by using direct API testing
- Sometimes Docker cleanup requires manual intervention (docker rm)
- See TESTS.md for detailed troubleshooting guides