import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
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

const methodNotAllowed = (req, res) => {
  logMcpDebug(`Received ${req.method} /mcp request`);
  res.set("Allow", "POST");
  jsonRpcError(res, 405, -32000, "Method not allowed for stateless transport.");
};

// Build the Express app for the stateless Streamable HTTP transport. A fresh
// MCP server and transport are created per request so no state is shared
// between clients.
export function createHttpApp({ createMcpServer, authToken, allowedHosts, bodyLimit }) {
  const app = express();
  app.disable("x-powered-by");

  // Validate Host before reading the body so rebinding attempts are cheap to reject
  if (allowedHosts) {
    app.use(hostHeaderValidation(allowedHosts));
  }
  if (authToken) {
    app.use(bearerAuth(authToken));
  }
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
