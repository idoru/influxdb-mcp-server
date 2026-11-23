import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { DEFAULT_MAX_CONCURRENT } from "../config/http.js";
import { logMcpDebug } from "../utils/loggerConfig.js";
import { traceTransport } from "../utils/traceTransport.js";

const jsonRpcError = (res, status, code, message, id = null) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id });

const sha256 = (value) => createHash("sha256").update(value).digest();

// Require "Authorization: Bearer <token>". Both sides are hashed first so the
// comparison is constant-time regardless of the provided token's length.
function bearerAuth(expectedToken) {
  const expected = sha256(expectedToken);
  return (req, res, next) => {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization || "");
    if (!match || !timingSafeEqual(sha256(match[1]), expected)) {
      res.set("WWW-Authenticate", 'Bearer realm="mcp"');
      jsonRpcError(res, 401, -32001, "Unauthorized");
      return;
    }
    next();
  };
}

// Reject requests carrying an Origin that is not explicitly allowed. Browsers
// send Origin on cross-site requests; native MCP clients do not send it.
function originValidation(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin === undefined || allowed.has(origin.toLowerCase().replace(/\/$/, ""))) {
      next();
      return;
    }
    jsonRpcError(res, 403, -32000, "Forbidden: Origin not allowed");
  };
}

// Bound the number of requests in flight; each can hold a long InfluxDB query
function concurrencyLimit(maxConcurrent) {
  let inFlight = 0;
  return (req, res, next) => {
    if (inFlight >= maxConcurrent) {
      res.set("Retry-After", "1");
      jsonRpcError(res, 503, -32000, "Server busy, retry later");
      return;
    }
    inFlight++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        inFlight--;
      }
    };
    res.on("finish", release);
    res.on("close", release);
    next();
  };
}

// Keep log lines single-line and short: these values come from the client
const sanitizeForLog = (value) => String(value).replace(/[^\x20-\x7e]/g, "?").slice(0, 64);

// JSON-RPC methods in a request, with the tool name for tools/call. Arguments,
// resource URIs and other params are never logged.
function describeRpc(body) {
  const messages = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  return messages
    .filter((message) => message && typeof message.method === "string")
    .map((message) =>
      message.method === "tools/call" && typeof message.params?.name === "string"
        ? `tools/call:${sanitizeForLog(message.params.name)}`
        : sanitizeForLog(message.method),
    );
}

// One audit line per request: status, duration, client address and the
// JSON-RPC methods / tool names called. No arguments, bodies or headers.
function accessLog(req, res, next) {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number((process.hrtime.bigint() - started) / 1000000n);
    const rpc = describeRpc(req.body);
    console.log(
      `HTTP ${req.method} ${sanitizeForLog(req.path)} ${res.statusCode} ${ms}ms ` +
        `client=${req.socket.remoteAddress}${rpc.length ? ` rpc=${rpc.join(",")}` : ""}`,
    );
  });
  next();
}

// nosniff and no-store on every response. The MCP SDK passes its own headers
// to writeHead (Cache-Control: no-cache for SSE), which would replace values
// set earlier, so keep no-store there too. no-transform stops proxies from
// buffering the event stream.
function securityHeaders(req, res, next) {
  res.set({ "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
  const writeHead = res.writeHead;
  res.writeHead = function (statusCode, ...rest) {
    const headers = rest.find((arg) => arg && typeof arg === "object" && !Array.isArray(arg));
    for (const key of Object.keys(headers || {})) {
      if (key.toLowerCase() === "cache-control") headers[key] = "no-store, no-transform";
    }
    return writeHead.call(this, statusCode, ...rest);
  };
  next();
}

const methodNotAllowed = (req, res) => {
  logMcpDebug(`Received ${req.method} /mcp request`);
  res.set("Allow", "POST");
  jsonRpcError(res, 405, -32000, "Method not allowed for stateless transport.");
};

// Build the Express app for the stateless Streamable HTTP transport. A fresh
// MCP server and transport are created per request so no state is shared
// between clients.
export function createHttpApp({
  createMcpServer,
  authToken,
  allowedHosts,
  allowedOrigins = [],
  bodyLimit,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
}) {
  const app = express();
  app.disable("x-powered-by");

  app.use(accessLog);
  app.use(securityHeaders);

  // Validate Host, Origin and credentials before reading the body so hostile
  // requests are cheap to reject
  if (allowedHosts) {
    app.use(hostHeaderValidation(allowedHosts));
  }
  app.use(originValidation(allowedOrigins));
  if (authToken) {
    app.use(bearerAuth(authToken));
  }
  app.use(concurrencyLimit(maxConcurrent));
  app.use(express.json({ limit: bodyLimit }));

  app.post("/mcp", async (req, res) => {
    logMcpDebug("HTTP POST /mcp received, creating new server and transport.");
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless
    });
    traceTransport(transport, "HTTP");

    res.on("close", () => {
      logMcpDebug("HTTP POST /mcp request closed, cleaning up server and transport.");
      // server.close() also closes the transport
      server.close().catch((error) => {
        console.error("Error closing MCP server:", error);
      });
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP HTTP request:", error);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Internal server error", req.body?.id ?? null);
      }
    }
  });

  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // Report body-parser failures as JSON-RPC errors instead of HTML pages
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error.type === "entity.too.large") {
      jsonRpcError(res, 413, -32600, `Request body exceeds the ${bodyLimit} limit`);
    } else if (error.type === "entity.parse.failed") {
      jsonRpcError(res, 400, -32700, "Parse error");
    } else {
      console.error("Unhandled HTTP error:", error);
      jsonRpcError(res, error.status || 500, -32603, "Internal server error");
    }
  });

  return app;
}
