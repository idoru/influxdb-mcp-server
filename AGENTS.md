# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the MCP server logic (transports, handlers, prompts, utilities). `src/index.js` is the CLI entry point; `src/server.js` builds the MCP server and registers resources, tools and prompts; `src/http/app.js` is the Express app for the Streamable HTTP transport; `src/handlers/` contains resource/tool implementations; `src/prompts/` stores reusable prompt templates.
- `src/config/` keeps environment and HTTP transport configuration, while `tests/` and `direct-tests/` house Jest suites that exercise the server via Dockerized InfluxDB instances (plus Docker-free unit and HTTP transport tests in `tests/`).
- Assets such as sample configs live near their consumers; look for README sections that reference `claude_desktop_config.json` paths when wiring integrations.

## Build, Test, and Development Commands
- `npm install` – installs dependencies (requires Node ≥ 20 because of commander 14).
- `npm start` – launches the stdio transport by default. Append `-- --http [port]` to expose the Streamable HTTP endpoint or `-- --stdio` to be explicit.
- `npm test` – runs the Jest suites; Docker must be available at `/Users/<user>/.docker/run/docker.sock` for integration cases.

## Coding Style & Naming Conventions
- Use ECMAScript modules with top-level `import`/`export`. Follow the existing two-space indentation and trailing commas for multi-line literals (see `src/index.js` for reference).
- Name files and exports after their responsibility (`writeDataTool.js`, `queryHandler.js`). Prefer descriptive, camelCase identifiers for functions and lower-case-with-dashes for CLI flags.
- Reuse shared utilities such as `configureLogger` and `validateEnvironment` rather than duplicating setup logic. When adding options, extend the Commander configuration near the top of `src/index.js`; HTTP transport settings belong in `src/config/http.js`.
- Interpolate user-supplied values into Flux only through `fluxString()` (`src/utils/flux.js`), and make InfluxDB calls through `influxRequest()` so timeouts apply.

## Testing Guidelines
- Jest is configured via `package.json` and expects `NODE_OPTIONS=--experimental-vm-modules`. Place end-to-end scenarios under `tests/` and unit-level handler checks under `direct-tests/`.
- Name test files after the feature under test (e.g., `handlers.test.js`) and keep setup/teardown symmetrical—see current suites for Docker cleanup patterns.
- Before opening a PR, ensure `npm test` passes locally with Docker running; add lightweight mocks if the new code cannot be exercised end-to-end.

## Commit & Pull Request Guidelines
- Follow the existing concise, imperative commit style (e.g., “Add Streamable HTTP transport option using Express”). Group related changes and avoid mixing refactors with functional updates unless necessary.
- PRs should describe the motivation, summarize key changes, and call out testing evidence (`npm test`, manual HTTP checks). If the change affects transport modes or configuration, include repro steps or screenshots for reviewers.

## Security & Configuration Tips
- Never hard-code secrets; the server reads `INFLUXDB_TOKEN` (and related org/bucket settings) from the environment. Use `.env` files locally but exclude them from commits.
- The HTTP transport listens on `127.0.0.1` with Host header validation by default, and refuses non-loopback interfaces unless `MCP_AUTH_TOKEN` (or `MCP_HTTP_ALLOW_UNAUTHENTICATED=true`) is set. Keep those defaults intact; anyone who can reach the endpoint acts with the server's InfluxDB token.
- `DEBUG=mcp:*` logs full MCP messages, including query text and written data; never enable it by default.
