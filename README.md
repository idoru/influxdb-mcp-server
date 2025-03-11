# InfluxDB MCP Server

A Model Context Protocol (MCP) server that exposes access to an InfluxDB instance using the InfluxDB OSS API v2. Mostly built with Claude Code.

## Features

This MCP server provides:

- **Resources**: Access to organization, bucket, and measurement data
- **Tools**: Write data, execute queries, and manage database objects
- **Prompts**: Templates for common Flux queries and Line Protocol format

## Resources

The server exposes the following resources:

1. **Organizations List**: `influxdb://orgs`
   - Displays all organizations in the InfluxDB instance

2. **Buckets List**: `influxdb://buckets`
   - Shows all buckets with their metadata

3. **Bucket Measurements**: `influxdb://bucket/{bucketName}/measurements`
   - Lists all measurements within a specified bucket

4. **Query Data**: `influxdb://query/{orgName}/{fluxQuery}`
   - Executes a Flux query and returns results as a resource

## Tools

The server provides these tools:

1. `write-data`: Write time-series data in line protocol format
   - Parameters: org, bucket, data, precision (optional)

2. `query-data`: Execute Flux queries
   - Parameters: org, query

3. `create-bucket`: Create a new bucket
   - Parameters: name, orgID, retentionPeriodSeconds (optional)

4. `create-org`: Create a new organization
   - Parameters: name, description (optional)

## Prompts

The server offers these prompt templates:

1. `flux-query-examples`: Common Flux query examples
2. `line-protocol-guide`: Guide to InfluxDB line protocol format

## Configuration

The server requires these environment variables:

- `INFLUXDB_TOKEN` (required): Authentication token for the InfluxDB API
- `INFLUXDB_URL` (optional): URL of the InfluxDB instance (defaults to `http://localhost:8086`)
- `INFLUXDB_ORG` (optional): Default organization name for certain operations

## Installation

### Option 1: Run with npx (recommended)

```bash
# Run directly with npx
INFLUXDB_TOKEN=your_token npx influxdb-mcp-server
```

### Option 2: Install globally

```bash
# Install globally
npm install -g influxdb-mcp-server

# Run the server
INFLUXDB_TOKEN=your_token influxdb-mcp-server
```

### Option 3: From source

```bash
# Clone the repository
git clone https://github.com/idoru/influxdb-mcp-server.git
cd influxdb-mcp-server

# Install dependencies
npm install

# Run the server
INFLUXDB_TOKEN=your_token npm start
```

## Integration with Claude for Desktop

Add the server to your `claude_desktop_config.json`:

### Using npx (recommended)

```json
{
  "mcpServers": {
    "influxdb": {
      "command": "npx",
      "args": ["influxdb-mcp-server"],
      "env": {
        "INFLUXDB_TOKEN": "your_token",
        "INFLUXDB_URL": "http://localhost:8086",
        "INFLUXDB_ORG": "your_org"
      }
    }
  }
}
```

### If installed locally

```json
{
  \"mcpServers\": {
    \"influxdb\": {
      \"command\": \"node\",
      \"args\": [\"/path/to/influxdb-mcp-server/src/index.js\"],
      \"env\": {
        \"INFLUXDB_TOKEN\": \"your_token\",
        \"INFLUXDB_URL\": \"http://localhost:8086\",
        \"INFLUXDB_ORG\": \"your_org\"
      }
    }
  }
}
```

## Code Structure

The server code is organized into a modular structure:

- `src/`
  - `index.js` - Main server entry point
  - `config/` - Configuration related files
    - `env.js` - Environment variable handling
  - `utils/` - Utility functions
    - `influxClient.js` - InfluxDB API client
    - `loggerConfig.js` - Console logger configuration
  - `handlers/` - Resource and tool handlers
    - `organizationsHandler.js` - Organizations listing
    - `bucketsHandler.js` - Buckets listing
    - `measurementsHandler.js` - Measurements listing
    - `queryHandler.js` - Query execution
    - `writeDataTool.js` - Data write tool
    - `queryDataTool.js` - Query tool
    - `createBucketTool.js` - Bucket creation tool
    - `createOrgTool.js` - Organization creation tool
  - `prompts/` - Prompt templates
    - `fluxQueryExamplesPrompt.js` - Flux query examples
    - `lineProtocolGuidePrompt.js` - Line protocol guide

This structure allows for better maintainability, easier testing, and clearer separation of concerns.

## Testing

The repository includes comprehensive integration tests that:

- Spin up a Docker container with InfluxDB
- Populate it with sample data
- Test all MCP server functionality

To run the tests:

```bash
npm test
```

## License

MIT
