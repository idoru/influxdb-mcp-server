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

4. **Query Data**: `influxdb://query/{orgName}/{fluxQuery}` (opt-in: set `INFLUXDB_ENABLE_QUERY_RESOURCE=true`)
   - Executes a Flux query and returns results as JSON (`headers` and one record per row, across all result tables)
   - Disabled by default because reading it runs arbitrary Flux, which can write data (`to()`) or reach other systems (`http`, `sql`), and clients may read resources without asking for approval. Use the `query-data` tool instead

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

Each tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) so clients can decide when to ask for approval. `query-data` is marked destructive and open-world because Flux can overwrite points and make network requests. Set `INFLUXDB_READ_ONLY=true` to register only `query-data`.

## Prompts

The server offers these prompt templates:

1. `flux-query-examples`: Common Flux query examples
2. `line-protocol-guide`: Guide to InfluxDB line protocol format

## Configuration

The server requires these environment variables:

- `INFLUXDB_TOKEN` (required): Authentication token for the InfluxDB API. Alternatively set `INFLUXDB_TOKEN_FILE` to a file containing it (e.g. a Docker or Kubernetes secret); setting both is an error
- `INFLUXDB_URL` (optional): `http://` or `https://` URL of the InfluxDB instance (defaults to `http://localhost:8086`). It must not contain credentials, a query string or a fragment; a path prefix is allowed. The server warns when it would send the token over plain `http://` to a non-loopback host
- `INFLUXDB_ORG` (optional): Default organization name for certain operations. When set, `org` becomes optional on the `write-data` and `query-data` tools
- `INFLUXDB_BUCKET` (optional): Default bucket name. When set, `bucket` becomes optional on the `write-data` tool
- `INFLUXDB_READ_ONLY` (optional): Set to `true` to register only the `query-data` tool (no `write-data`, `create-bucket` or `create-org`). Flux can still write with `to()`, so pair it with a read-only token
- `INFLUXDB_ENABLE_QUERY_RESOURCE` (optional): Set to `true` to register the `influxdb://query/...` resource
- `INFLUXDB_MAX_RESPONSE_BYTES` (optional): Largest InfluxDB response the server will buffer, in bytes (defaults to 10485760, i.e. 10 MiB). Larger query results fail with an error instead of exhausting memory
- `DEBUG` (optional): Set to `mcp:*` to log every MCP message to stderr. This includes query text and written data, so leave it off in production

Boolean settings accept only `true` or `false`; any other value stops the server so a typo cannot silently leave a protection off.

The following variables apply only to the Streamable HTTP transport (see [HTTP transport security](#http-transport-security)):

- `MCP_HTTP_HOST` (optional): Interface to listen on (defaults to `127.0.0.1`; same as `--host`)
- `MCP_AUTH_TOKEN` (optional): When set, every request must send `Authorization: Bearer <token>`. Must be at least 32 characters (e.g. `openssl rand -hex 32`). Required to listen on a non-loopback interface. `MCP_AUTH_TOKEN_FILE` reads it from a file instead
- `MCP_ALLOWED_HOSTS` (optional): Comma-separated hostnames (ports are ignored) accepted in the `Host` header. Defaults to `localhost,127.0.0.1,[::1]` plus the bind address on loopback; unset means no `Host` check on other interfaces. Required for unauthenticated non-loopback servers
- `MCP_ALLOWED_ORIGINS` (optional): Comma-separated browser origins (e.g. `https://app.example.com`) allowed to call the server. Requests carrying any other `Origin` header are rejected; native MCP clients send none. Defaults to none
- `MCP_HTTP_ALLOW_UNAUTHENTICATED` (optional): Set to `true` to listen on a non-loopback interface without `MCP_AUTH_TOKEN`, e.g. behind a reverse proxy that authenticates for you. `MCP_ALLOWED_HOSTS` must then be set
- `MCP_HTTP_MAX_CONCURRENT` (optional): Maximum requests handled at once (defaults to 32); further requests get `503` with `Retry-After`
- `MCP_HTTP_BODY_LIMIT` (optional): Maximum request body size (defaults to `4mb`; accepts `b`, `kb` or `mb` suffixes). Raise it for very large `write-data` batches

Requests to InfluxDB time out after 10 seconds (60 seconds for queries, 30 seconds for writes), including the time spent reading the response. Redirects from InfluxDB are refused so the token is never sent elsewhere.

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

Node.js 22 or later is required.

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
- It rejects requests from browser origins not listed in `MCP_ALLOWED_ORIGINS`.
- It refuses to listen on any other interface unless `MCP_AUTH_TOKEN` (at least 32 characters) is set, or `MCP_HTTP_ALLOW_UNAUTHENTICATED=true` together with `MCP_ALLOWED_HOSTS`.
- It caps concurrent requests and logs one line per request to stderr (status, client address, JSON-RPC method and tool name; never arguments or headers).

To expose the server on your network, or from a container, require a bearer token:

```bash
# Prefer secret files (or your shell's secret store) over typing tokens on the command line
INFLUXDB_TOKEN_FILE=/run/secrets/influxdb_token MCP_AUTH_TOKEN_FILE=/run/secrets/mcp_auth_token \
  influxdb-mcp-server --http 3000 --host 0.0.0.0
```

Clients then send `Authorization: Bearer <MCP_AUTH_TOKEN>` with each request. Set `MCP_ALLOWED_HOSTS` to the hostnames clients use to reach the server for additional DNS rebinding protection. Prefer terminating TLS in front of the server when it is reachable beyond your machine.

### Docker

The image is built from a digest-pinned `node:26-alpine`, runs as the unprivileged `node` user and uses stdio by default. Pass secrets with `--env-file` (or `-e VAR` without a value, which copies it from your environment) rather than `-e VAR=value`, which lands in shell history and process listings:

```bash
docker build -t influxdb-mcp-server .
# influxdb.env contains INFLUXDB_TOKEN=... and INFLUXDB_URL=http://host.docker.internal:8086
docker run --rm -i --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --env-file influxdb.env influxdb-mcp-server

# Streamable HTTP inside a container must bind 0.0.0.0, so it needs a token
# (MCP_AUTH_TOKEN in the env file, at least 32 characters)
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  -p 127.0.0.1:3000:3000 --env-file influxdb.env \
  influxdb-mcp-server --http 3000 --host 0.0.0.0
```

## Security model

The server acts with its InfluxDB token on behalf of whatever drives it: the MCP client, the model, and anything that can influence the model. Treat the token as the real security boundary.

- **Scope the token.** Give the server a token with only the permissions it needs, ideally read-only and limited to specific buckets. Use an operator or all-access token only if you need `create-org`.
- **`INFLUXDB_ORG` and `INFLUXDB_BUCKET` are defaults, not boundaries.** Tools accept any org or bucket the token can reach.
- **Read-only mode.** `INFLUXDB_READ_ONLY=true` removes the write and admin tools. Flux can still write with `to()`, so pair it with a read-only token.
- **Flux reaches the network.** Queries run inside InfluxDB, and Flux's `http`, `sql` and `influxdata/influxdb/secrets` packages can call other systems or read secrets from the InfluxDB host. Restrict that host's outbound network access and the token's permissions accordingly.
- **Prompt injection.** Data returned by queries (tag values, field strings, descriptions) is passed to the model and may contain instructions planted by whoever wrote it. Keep tool approval prompts on for write and query tools.
- **TLS.** Put a TLS-terminating reverse proxy in front of the HTTP transport when it is reachable beyond your machine. Use `https://` for `INFLUXDB_URL`; for a private CA set `NODE_EXTRA_CA_CERTS`, never `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **One shared bearer token.** `MCP_AUTH_TOKEN` gives every holder the same access, with no per-client identity or revocation. For multi-user deployments, put an authenticating proxy in front of the server.
- **Secrets on disk and in config.** Prefer `*_FILE` variables or `--env-file` to inline tokens, restrict permissions on `claude_desktop_config.json`, and pin the package version you run (e.g. `npx influxdb-mcp-server@0.5.0`).

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Upgrading to 0.5.0

0.5.0 tightens several defaults:

- The `influxdb://query/...` resource is off unless `INFLUXDB_ENABLE_QUERY_RESOURCE=true`.
- `MCP_AUTH_TOKEN` must be at least 32 characters.
- Unauthenticated non-loopback HTTP servers (`MCP_HTTP_ALLOW_UNAUTHENTICATED=true`) must set `MCP_ALLOWED_HOSTS`.
- Requests with an `Origin` header not listed in `MCP_ALLOWED_ORIGINS` are rejected.
- `INFLUXDB_URL` must be an `http(s)` URL without credentials, query string or fragment.
- InfluxDB responses larger than `INFLUXDB_MAX_RESPONSE_BYTES` (10 MiB) fail instead of being buffered.
- Boolean settings must be exactly `true` or `false`.
- Node.js 22 or later is required.
- `npm test` no longer runs the suites that need InfluxDB; see [Testing](#testing).

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
    - `env.js` - Environment variable handling and validation
    - `http.js` - HTTP transport options and safety checks
    - `secrets.js` - Reading secrets from variables or `*_FILE` paths
  - `http/` - Streamable HTTP transport
    - `app.js` - Express app (Host and Origin validation, bearer auth, body and concurrency limits, access log)
  - `utils/` - Utility functions
    - `influxClient.js` - InfluxDB API client with request timeouts and response size limits
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

`npm test` runs the suites that need neither Docker nor InfluxDB: the HTTP transport's Host and Origin validation, authentication and limits, configuration checks, the InfluxDB client's timeouts and size limits, and the CSV and Flux helpers.

```bash
npm test
```

The integration suites need an InfluxDB 2.x instance on a loopback address. `scripts/test-influx.sh` starts a throwaway one with Docker Compose (random credentials, `127.0.0.1` only), runs them and removes it again. The tests themselves never talk to Docker and delete only what they created:

```bash
scripts/test-influx.sh
# or, against an instance you started yourself
INFLUXDB_TEST_URL=http://127.0.0.1:8086 INFLUXDB_TEST_ADMIN_TOKEN=... INFLUXDB_TEST_ORG=... npm run test:integration
```

See [TESTS.md](TESTS.md) for details.

## License

MIT
