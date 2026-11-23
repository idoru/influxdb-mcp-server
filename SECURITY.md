# Security Policy

## Supported versions

Security fixes are made on the latest release line.

| Version | Supported |
|---------|-----------|
| 0.5.x   | Yes       |
| < 0.5   | No        |

## Reporting a vulnerability

Please report vulnerabilities privately through this repository's **Security** tab ("Report a vulnerability"), which opens a GitHub Security Advisory visible only to the maintainers. Do not open a public issue.

Include the affected version, configuration (transport, relevant environment variables with secrets removed), steps to reproduce and the impact you expect. You should get an acknowledgement within a week.

## Scope

The server holds an InfluxDB token and acts with it on behalf of its MCP client and the model driving it. In scope:

- Bypassing the HTTP transport's controls: Host and Origin validation, bearer authentication, body and concurrency limits, or the refusal to listen on non-loopback interfaces unsafely
- Injection into Flux or InfluxDB API requests through tool or resource parameters
- Read-only mode or the opt-in query resource exposing write or admin capability
- Leaking the InfluxDB token, `MCP_AUTH_TOKEN` or query data through logs, errors or responses
- Resource exhaustion that bypasses the configured limits
- Supply-chain issues in this repository's dependencies, build or CI

Out of scope:

- Anything the configured InfluxDB token is itself permitted to do (scope the token instead; see "Security model" in the README)
- Flux features such as `http`, `sql` or `secrets` that InfluxDB executes on its own host
- Prompt injection through data stored in InfluxDB, beyond the controls described in the README
- Deployments that set `MCP_HTTP_ALLOW_UNAUTHENTICATED=true` without an authenticating proxy in front
