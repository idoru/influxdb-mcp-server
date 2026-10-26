// Configuration for the Streamable HTTP transport, resolved from CLI options
// and environment variables. Throws an Error with a user-facing message when
// the configuration is invalid or unsafe.

export const DEFAULT_HTTP_PORT = 3000;
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_BODY_LIMIT = "4mb";

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

const parseList = (value) =>
  (value || "")
    .split(",")
    .map((item) => toHostname(item.trim().toLowerCase()))
    .filter(Boolean);

export function resolveHttpConfig(options = {}, env = process.env) {
  const port = parsePort(options.http);
  // listen() expects IPv6 addresses without brackets
  const host = (options.host || env.MCP_HTTP_HOST || DEFAULT_HTTP_HOST).trim().replace(/^\[(.*)\]$/, "$1");
  const authToken = env.MCP_AUTH_TOKEN?.trim() || undefined;
  if (authToken && /\s/.test(authToken)) {
    throw new Error("MCP_AUTH_TOKEN must not contain whitespace.");
  }
  const allowUnauthenticated = env.MCP_HTTP_ALLOW_UNAUTHENTICATED === "true";
  const bodyLimit = parseBodyLimit(env.MCP_HTTP_BODY_LIMIT);
  const loopback = isLoopbackHost(host);

  if (!loopback && !authToken && !allowUnauthenticated) {
    throw new Error(
      `Refusing to listen on non-loopback host "${host}" without authentication. ` +
        "Set MCP_AUTH_TOKEN to require a bearer token, or set " +
        "MCP_HTTP_ALLOW_UNAUTHENTICATED=true if access is controlled elsewhere (e.g. a reverse proxy).",
    );
  }

  // Host header validation blocks DNS rebinding. Loopback servers get it by
  // default; servers on other interfaces rely on MCP_ALLOWED_HOSTS and/or auth.
  let allowedHosts = parseList(env.MCP_ALLOWED_HOSTS);
  if (allowedHosts.length === 0) {
    allowedHosts = loopback ? ["localhost", "127.0.0.1", "[::1]"] : null;
  }

  return { port, host, authToken, allowUnauthenticated, allowedHosts, bodyLimit };
}
