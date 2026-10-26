#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

// Import config
import { validateEnvironment } from "./config/env.js";
import { resolveHttpConfig } from "./config/http.js";

// Import utilities
import { configureLogger } from "./utils/loggerConfig.js";
import { traceTransport } from "./utils/traceTransport.js";

import { createMcpServer } from "./server.js";
import { createHttpApp } from "./http/app.js";

// Configure logger and validate environment
configureLogger();
validateEnvironment();

// Parse command-line arguments
program
  .option("--http [port]", "Start server with Streamable HTTP transport on specified port (default: 3000)")
  .option("--host <host>", "Interface for the HTTP transport to listen on (default: 127.0.0.1, or MCP_HTTP_HOST)")
  .option("--stdio", "Force stdio transport (default behavior)")
  .parse(process.argv);

const options = program.opts();

if (options.http !== undefined && options.stdio) {
  console.error("Cannot use --http and --stdio at the same time. Please choose one transport.");
  process.exit(1);
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

// Exit promptly on termination signals (node does not do this by default when
// running as PID 1, e.g. in Docker)
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down`);
    process.exit(0);
  });
}

if (options.http === undefined) {
  // Start the server with stdio transport
  console.log("Starting MCP server with stdio transport...");
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  traceTransport(transport, "STDIO");

  try {
    await server.connect(transport);
    console.log("MCP server connected to stdio transport");
  } catch (error) {
    console.error("Error starting MCP server with stdio:", error);
    process.exit(1);
  }
} else {
  // Start the server with Streamable HTTP transport
  let config;
  try {
    config = resolveHttpConfig(options);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const { port, host, authToken, allowUnauthenticated, allowedHosts } = config;
  const app = createHttpApp({ createMcpServer, ...config });

  const httpServer = app.listen(port, host, () => {
    const displayHost = host.includes(":") ? `[${host}]` : host;
    console.log(`MCP Streamable HTTP Server listening on http://${displayHost}:${port}/mcp`);
    console.log(
      `Authentication: ${authToken ? "bearer token required" : "none"}; ` +
        `Host header validation: ${allowedHosts ? allowedHosts.join(", ") : "disabled"}`,
    );
    if (!authToken && allowUnauthenticated) {
      console.warn(
        `MCP_HTTP_ALLOW_UNAUTHENTICATED is set: anyone who can reach ${displayHost}:${port} can use the InfluxDB token.`,
      );
    }
  });

  httpServer.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Error: Port ${port} is already in use. Please choose a different port or free up port ${port}.`);
    } else {
      console.error("Failed to start HTTP server:", err);
    }
    process.exit(1);
  });
}
