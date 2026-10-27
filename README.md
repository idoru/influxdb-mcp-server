# InfluxDB v2 MCP Server

[![MseeP Badge](https://mseep.net/pr/idoru-influxdb-mcp-server-badge.jpg)](https://mseep.ai/app/idoru-influxdb-mcp-server)

[![LightNow](https://lightnow.ai/badge/io.github.idoru/influxdb-mcp-server)](https://lightnow.ai/servers/io.github.idoru/influxdb-mcp-server)

[![Listed on Spark](https://spark.entire.vc/badges/listed.svg)](https://spark.entire.vc/assets/vb-influxdb?utm_source=github&utm_medium=readme)
[![Install via Spark](https://spark.entire.vc/badges/vb-influxdb/install.svg)](https://spark.entire.vc/assets/vb-influxdb?utm_source=github&utm_medium=readme)

[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/idoru/influxdb-mcp-server)](https://archestra.ai/mcp-catalog/idoru__influxdb-mcp-server)

A Model Context Protocol (MCP) server that exposes access to an InfluxDB v2 instance using the InfluxDB OSS API v2. Mostly built with Claude Code.

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
   - Lists all measurements within a specified bucket (uses `INFLUXDB_ORG`)

4. **Query Data**: `influxdb://query/{orgName}/{fluxQuery}`
   - Executes a Flux query and returns results as JSON (`headers` and one record per row, across all result tables)

Template variables (`bucketName`, `orgName`, `fluxQuery`) must be percent-encoded, e.g. with `encodeURIComponent`, so names containing spaces or `/` and multi-line queries survive the URI.

## Tools

The server provides these tools:

1. `write-data`: Write time-series data in line protocol format
   - Parameters: org, bucket, data, precision (optional)
   - `org` and `bucket` are optional when `INFLUXDB_ORG` / `INFLUXDB_BUCKET` are set, and fall back to those values

2. `query-data`: Execute Flux queries
   - Parameters: org, query
   - `org` is optional when `INFLUXDB_ORG` is set, and falls back to that value

3. `create-bucket`: Create a new bucket
   - Parameters: name, orgID, retentionPeriodSeconds (optional, whole seconds; omit or pass 0 for infinite retention)

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
- `INFLUXDB_ORG` (optional): Default organization name for certain operations. When set, `org` becomes optional on the `write-data` and `query-data` tools
- `INFLUXDB_BUCKET` (optional): Default bucket name. When set, `bucket` becomes optional on the `write-data` tool
- `DEBUG` (optional): Set to `mcp:*` to log every MCP message to stderr. This includes query text and written data, so leave it off in production

The following variables apply only to the Streamable HTTP transport (see [HTTP transport security](#http-transport-security)):

- `MCP_HTTP_HOST` (optional): Interface to listen on (defaults to `127.0.0.1`; same as `--host`)
- `MCP_AUTH_TOKEN` (optional): When set, every request must send `Authorization: Bearer <token>`. Required to listen on a non-loopback interface
- `MCP_ALLOWED_HOSTS` (optional): Comma-separated hostnames (ports are ignored) accepted in the `Host` header. Defaults to `localhost,127.0.0.1,[::1]` plus the bind address on loopback; unset means no `Host` check on other interfaces
- `MCP_HTTP_ALLOW_UNAUTHENTICATED` (optional): Set to `true` to listen on a non-loopback interface without `MCP_AUTH_TOKEN`, e.g. behind a reverse proxy that authenticates for you
- `MCP_HTTP_BODY_LIMIT` (optional): Maximum request body size (defaults to `4mb`; accepts `b`, `kb` or `mb` suffixes). Raise it for very large `write-data` batches

Requests to InfluxDB time out after 10 seconds (60 seconds for queries, 30 seconds for writes), including the time spent reading the response.

## Installation

### Installing via Smithery

To install InfluxDB MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@idoru/influxdb-mcp-server):

```bash
npx -y @smithery/cli install @idoru/influxdb-mcp-server --client claude
```

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

Node.js 20 or later is required.

`influxdb-mcp-server` uses stdio transport by default. You can explicitly request it with `--stdio`, or start the server with Streamable HTTP transport by providing the `--http` option with an optional port number (defaults to 3000). This mode uses an internal Express.js server that listens on `127.0.0.1` unless `--host` is given:

```bash
# Start with Streamable HTTP transport on default port 3000
INFLUXDB_TOKEN=your_token npm start -- --http

# Start with Streamable HTTP transport on a specific port
INFLUXDB_TOKEN=your_token npm start -- --http 8080
```

If you installed globally or are using npx, you can run:
```bash
INFLUXDB_TOKEN=your_token influxdb-mcp-server --http
# or explicitly force stdio
INFLUXDB_TOKEN=your_token influxdb-mcp-server --stdio
# or
INFLUXDB_TOKEN=your_token influxdb-mcp-server --http 8080
```

### HTTP transport security

Anyone who can reach the HTTP endpoint can read and write InfluxDB with the server's `INFLUXDB_TOKEN`, so the HTTP transport is locked down by default:

- It listens on `127.0.0.1` only.
- On loopback it rejects requests whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]`, which blocks [DNS rebinding](https://en.wikipedia.org/wiki/DNS_rebinding) attacks from websites open in your browser.
- It refuses to listen on any other interface unless `MCP_AUTH_TOKEN` is set (or `MCP_HTTP_ALLOW_UNAUTHENTICATED=true`).

To expose the server on your network, or from a container, require a bearer token:

```bash
INFLUXDB_TOKEN=your_token MCP_AUTH_TOKEN="$(openssl rand -hex 32)" \
  influxdb-mcp-server --http 3000 --host 0.0.0.0
```

Clients then send `Authorization: Bearer <MCP_AUTH_TOKEN>` with each request. Set `MCP_ALLOWED_HOSTS` to the hostnames clients use to reach the server for additional DNS rebinding protection. Prefer terminating TLS in front of the server when it is reachable beyond your machine.

### Docker

The image runs as the unprivileged `node` user and uses stdio by default:

```bash
docker build -t influxdb-mcp-server .
docker run --rm -i -e INFLUXDB_TOKEN=your_token -e INFLUXDB_URL=http://host.docker.internal:8086 influxdb-mcp-server

# Streamable HTTP inside a container must bind 0.0.0.0, so it needs a token
docker run --rm -p 127.0.0.1:3000:3000 -e INFLUXDB_TOKEN=your_token -e MCP_AUTH_TOKEN=your_mcp_token \
  influxdb-mcp-server --http 3000 --host 0.0.0.0
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
        "INFLUXDB_ORG": "your_org",
        "INFLUXDB_BUCKET": "your_bucket"
      }
    }
  }
}
```

### If installed locally

```json
{
  "mcpServers": {
    "influxdb": {
      "command": "node",
      "args": ["/path/to/influxdb-mcp-server/src/index.js"],
      "env": {
        "INFLUXDB_TOKEN": "your_token",
        "INFLUXDB_URL": "http://localhost:8086",
        "INFLUXDB_ORG": "your_org",
        "INFLUXDB_BUCKET": "your_bucket"
      }
    }
  }
}
```

## Code Structure

The server code is organized into a modular structure:

- `src/`
  - `index.js` - CLI entry point (argument parsing and transport selection)
  - `server.js` - MCP server factory registering resources, tools and prompts
  - `config/` - Configuration related files
    - `env.js` - Environment variable handling
    - `http.js` - HTTP transport options and safety checks
  - `http/` - Streamable HTTP transport
    - `app.js` - Express app (Host validation, bearer auth, body limits)
  - `utils/` - Utility functions
    - `influxClient.js` - InfluxDB API client with request timeouts
    - `csv.js` - Flux CSV response parser
    - `flux.js` - Flux string escaping and URI parameter decoding
    - `loggerConfig.js` - Console logger configuration and `DEBUG` tracing
    - `traceTransport.js` - MCP message tracing for `DEBUG=mcp:*`
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

The repository includes comprehensive tests that:

- Spin up a Docker container with InfluxDB
- Populate it with sample data
- Test all MCP server functionality
- Exercise the HTTP transport's Host validation, authentication and limits, and the CSV and Flux helpers, without Docker

To run the tests:

```bash
npm test
```

## License

MIT
