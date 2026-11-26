import { readSecret } from "./secrets.js";

// Configuration for the Streamable HTTP transport, resolved from CLI options
// and environment variables. Throws an Error with a user-facing message when
// the configuration is invalid or unsafe.

export const DEFAULT_HTTP_PORT = 3000;
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_BODY_LIMIT = "4mb";
export const DEFAULT_MAX_CONCURRENT = 32;
export const MIN_AUTH_TOKEN_LENGTH = 32;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

export const isLoopbackHost = (host) =>
  LOOPBACK_HOSTS.includes(host.toLowerCase()) || /^127(\.\d{1,3}){3}$/.test(host);

function parsePort(value) {
  if (value === undefined || value === true) return DEFAULT_HTTP_PORT;
  const port = /^\d+$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid HTTP port "${value}". Expected an integer between 1 and 65535.`);
  }
  return port;
}

function parseBodyLimit(value) {
  const limit = (value || DEFAULT_BODY_LIMIT).trim().toLowerCase();
  // body-parser silently disables size enforcement for unparseable limits, so
  // only accept values it is guaranteed to understand
  if (!/^\d+(b|kb|mb)?$/.test(limit)) {
    throw new Error(`Invalid MCP_HTTP_BODY_LIMIT "${value}". Use a size such as "512kb" or "4mb".`);
  }
  return limit;
}

// Host header validation compares URL.hostname (no port, IPv6 in brackets)
function toHostname(host) {
  const withoutPort = host.replace(/^([^:[\]]+):\d+$/, "$1").replace(/^(\[[^\]]+\]):\d+$/, "$1");
  return withoutPort.includes(":") && !withoutPort.startsWith("[") ? `[${withoutPort}]` : withoutPort;
}

function parseMaxConcurrent(value) {
  if (value === undefined || value.trim() === "") return DEFAULT_MAX_CONCURRENT;
  const max = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error(`Invalid MCP_HTTP_MAX_CONCURRENT "${value}". Expected a positive integer.`);
  }
  return max;
}

// Browsers send Origin on cross-site requests; native MCP clients do not.
// Entries are exact origins such as "https://app.example.com".
function parseOrigins(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/\/$/, ""))
    .filter(Boolean)
    .map((item) => {
      let origin;
      try {
        origin = new URL(item).origin;
      } catch {
        origin = null;
      }
      if (origin !== item) {
        throw new Error(
          `Invalid MCP_ALLOWED_ORIGINS entry "${item}". Use scheme://host[:port], e.g. "https://app.example.com".`,
        );
      }
      return origin;
    });
}

const parseList = (value) =>
  (value || "")
    .split(",")
    .map((item) => toHostname(item.trim().toLowerCase()))
    .filter(Boolean);

export function resolveHttpConfig(options = {}, env = process.env) {
  const port = parsePort(options.http);
  // listen() expects IPv6 addresses without brackets
  const host = (options.host || env.MCP_HTTP_HOST || DEFAULT_HTTP_HOST).trim().replace(/^\[(.*)\]$/, "$1");
  const authToken = readSecret(env, "MCP_AUTH_TOKEN")?.trim() || undefined;
  if (authToken && /\s/.test(authToken)) {
    throw new Error("MCP_AUTH_TOKEN must not contain whitespace.");
  }
  if (authToken && authToken.length < MIN_AUTH_TOKEN_LENGTH) {
    throw new Error(
      `MCP_AUTH_TOKEN must be at least ${MIN_AUTH_TOKEN_LENGTH} characters. Generate one with: openssl rand -hex 32`,
    );
  }
  const allowUnauthenticated = env.MCP_HTTP_ALLOW_UNAUTHENTICATED === "true";
  const bodyLimit = parseBodyLimit(env.MCP_HTTP_BODY_LIMIT);
  const allowedOrigins = parseOrigins(env.MCP_ALLOWED_ORIGINS);
  const maxConcurrent = parseMaxConcurrent(env.MCP_HTTP_MAX_CONCURRENT);
  const loopback = isLoopbackHost(host);

  if (!loopback && !authToken && !allowUnauthenticated) {
    throw new Error(
      `Refusing to listen on non-loopback host "${host}" without authentication. ` +
        "Set MCP_AUTH_TOKEN to require a bearer token, or set " +
        "MCP_HTTP_ALLOW_UNAUTHENTICATED=true if access is controlled elsewhere (e.g. a reverse proxy).",
    );
  }

  // Without authentication, Host validation is the only defence against DNS
  // rebinding, so an unauthenticated non-loopback server must name its hosts
  const configuredHosts = parseList(env.MCP_ALLOWED_HOSTS);
  if (!loopback && !authToken && configuredHosts.length === 0) {
    throw new Error(
      `Refusing to listen on non-loopback host "${host}" without authentication or MCP_ALLOWED_HOSTS. ` +
        "Set MCP_ALLOWED_HOSTS to the hostnames clients (or your reverse proxy) use to reach the server.",
    );
  }

  // Host header validation blocks DNS rebinding. Loopback servers get it by
  // default; servers on other interfaces rely on MCP_ALLOWED_HOSTS and/or auth.
  let allowedHosts = configuredHosts;
  if (allowedHosts.length === 0) {
    // Include the bind address itself so e.g. --host 127.0.0.2 accepts its own Host
    allowedHosts = loopback
      ? [...new Set(["localhost", "127.0.0.1", "[::1]", toHostname(host.toLowerCase())])]
      : null;
  }

  return { port, host, authToken, allowUnauthenticated, allowedHosts, allowedOrigins, bodyLimit, maxConcurrent };
}
