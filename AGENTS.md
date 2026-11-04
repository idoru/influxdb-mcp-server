# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the MCP server logic, including transports, handlers, prompts, and utilities.
  - `src/index.js` is the CLI entry point.
  - `src/server.js` creates the MCP server and registers resources, tools, and prompts.
  - `src/http/app.js` implements the Express app for the Streamable HTTP transport, including Host validation, authentication, and request-size limits.
  - `src/handlers/` contains resource and tool implementations.
  - `src/prompts/` stores reusable prompt templates.
  - `src/config/` contains environment and HTTP transport configuration (`env.js` and `http.js`).
  - `src/utils/` contains shared utilities, including the InfluxDB client, Flux CSV parser, Flux escaping, and logging.
- `tests/` contains integration tests using Dockerized InfluxDB instances, as well as Docker-free unit and HTTP transport tests.
- `direct-tests/` contains handler tests against a Dockerized InfluxDB instance.
- Keep assets and sample configurations near their consumers. Check README references to `claude_desktop_config.json` when wiring integrations.

## Build, Test, and Development Commands

- `npm install` — install dependencies. Node.js 20 or later is required because the project uses Commander 14.
- `npm start` — launch the server using the default stdio transport.
- `npm start -- --http [port]` — launch the Streamable HTTP transport.
- `npm start -- --stdio` — explicitly select the stdio transport.
- `INFLUXDB_TOKEN=your_token node src/index.js` — start the server directly with an InfluxDB token.
- `npm test` — run the Jest test suites.
- `npm test -- -t "test name"` — run a single test by name (for example, `npm test -- -t "should list organizations"`).
- `npm test -- --testPathIgnorePatterns=integration.test.js` — skip integration tests.
- Ensure Docker is running before executing tests that require InfluxDB containers. On macOS, the Docker socket may be expected at `/Users/<user>/.docker/run/docker.sock`.
- Set `DEBUG=mcp:*` to enable detailed MCP protocol logging when debugging. This logs full messages, including query text and written data; do not enable it by default.

## Coding Style & Naming Conventions

- Use JavaScript with ECMAScript modules and top-level `import`/`export`. Source files use the `.js` extension.
- Use two-space indentation and trailing commas in multi-line literals.
- Use descriptive, responsibility-based file and export names (for example, `writeDataTool.js` and `queryHandler.js`).
- Use `camelCase` for variables and functions, `PascalCase` for classes, and lowercase kebab-case for CLI flags.
- Use Zod for runtime type validation.
- Prefer `async`/`await` over raw promise chains.
- Handle errors with `try`/`catch` blocks and structured error messages.
- Prefer named ES module imports.
- Reuse shared utilities such as `configureLogger` and `validateEnvironment` rather than duplicating setup logic.
- When adding CLI options, extend the Commander configuration near the top of `src/index.js`. HTTP transport settings belong in `src/config/http.js`.
- Interpolate user-supplied values into Flux only through `fluxString()` (`src/utils/flux.js`).
- Route InfluxDB calls through `influxRequest()` so request timeouts are applied.

## Testing Guidelines

- Jest is used for testing and is configured through `package.json`.
- Jest requires `NODE_OPTIONS=--experimental-vm-modules`.
- The Jest timeout is 60 seconds to accommodate Docker operations.
- Place end-to-end scenarios under `tests/` and unit-level handler checks under `direct-tests/`.
- Name test files after the feature under test (for example, `handlers.test.js`).
- Keep test setup and teardown symmetrical, following existing Docker cleanup patterns.
- Integration tests use Docker to start a real InfluxDB instance. Ensure containers are properly cleaned up after tests.
- Tests primarily use direct API communication for reliability. Server-process behavior is tested through direct process spawning and API verification.
- Tests mock `src/config/env.js` and `src/utils/influxClient.js` using explicit export lists. Update these mocks when adding exports imported by handlers.
- Add lightweight mocks when new code cannot be exercised end-to-end.
- Before opening a PR, run `npm test` locally with Docker available and verify that all tests pass.

## Environment Variables

- **Required:**
  - `INFLUXDB_TOKEN` — InfluxDB authentication token.
- **Optional:**
  - `INFLUXDB_URL` — InfluxDB URL; defaults to `http://localhost:8086`.
  - `INFLUXDB_ORG` — organization name used for queries.
  - `INFLUXDB_BUCKET` — default bucket used for write operations.
  - `DEBUG=mcp:*` — enables detailed MCP protocol logging, including full messages and data.
- **HTTP transport (`--http` only):**
  - `MCP_HTTP_HOST` — bind interface; defaults to `127.0.0.1`. Equivalent to `--host`.
  - `MCP_AUTH_TOKEN` — requires an `Authorization: Bearer` token. Mandatory for non-loopback interfaces unless unauthenticated access is explicitly enabled.
  - `MCP_ALLOWED_HOSTS` — comma-separated Host header allowlist.
  - `MCP_HTTP_ALLOW_UNAUTHENTICATED=true` — explicitly opts out of the authentication requirement on non-loopback interfaces.
  - `MCP_HTTP_BODY_LIMIT` — maximum HTTP request body size; defaults to `4mb`.

## Security & Configuration Guidelines

- Never hard-code secrets. Read `INFLUXDB_TOKEN` and related organization and bucket settings from environment variables.
- Use local `.env` files when appropriate, but never commit them.
- Preserve the HTTP transport's secure defaults:
  - Bind to `127.0.0.1` by default.
  - Validate the Host header.
  - Refuse non-loopback interfaces unless `MCP_AUTH_TOKEN` is configured or `MCP_HTTP_ALLOW_UNAUTHENTICATED=true` is explicitly set.
- Anyone who can reach the HTTP endpoint can act with the server's InfluxDB token. Treat changes to HTTP exposure and authentication as security-sensitive.
- Never enable `DEBUG=mcp:*` by default because it logs full MCP messages, including query text and written data.

## Commit & Pull Request Guidelines

- Follow the existing concise, imperative commit-message style (for example, `Add Streamable HTTP transport option using Express`).
- Group related changes together. Avoid mixing refactors with functional changes unless necessary.
- PR descriptions should:
  - Explain the motivation for the change.
  - Summarize the key modifications.
  - Include testing evidence, such as `npm test` results and manual HTTP checks.
  - Include reproduction steps or screenshots when changes affect transport modes or configuration.

## Troubleshooting

- Docker must be running for integration tests.
- Port conflicts may occur if another service is using port `8086`.
- Direct API testing can help bypass MCP client connection issues during debugging.
- Docker cleanup may occasionally require manual intervention, such as `docker rm`.
- Consult `TESTS.md` for detailed testing and troubleshooting guidance.

## Guardrails

- Never commit secrets, credentials, tokens, or private keys.
- Validate untrusted input at appropriate boundaries.
- Use parameterized queries and safe APIs for external input.
- Avoid logging sensitive information.
- Follow least-privilege principles.
- Do not disable security controls to bypass errors.
