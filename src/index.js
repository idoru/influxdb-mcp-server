#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { program } from "commander";
import express from "express";

// Import config
import { validateEnvironment } from "./config/env.js";

// Import utilities
import { configureLogger } from "./utils/loggerConfig.js";

// Import resource handlers
import { listOrganizations } from "./handlers/organizationsHandler.js";
import { listBuckets } from "./handlers/bucketsHandler.js";
import { bucketMeasurements } from "./handlers/measurementsHandler.js";
import { executeQuery } from "./handlers/queryHandler.js";

// Import tool handlers
import { writeData } from "./handlers/writeDataTool.js";
import { queryData } from "./handlers/queryDataTool.js";
import { createBucket } from "./handlers/createBucketTool.js";
import { createOrg } from "./handlers/createOrgTool.js";

// Import prompt handlers
import { fluxQueryExamplesPrompt } from "./prompts/fluxQueryExamplesPrompt.js";
import { lineProtocolGuidePrompt } from "./prompts/lineProtocolGuidePrompt.js";

// Configure logger and validate environment
configureLogger();
validateEnvironment();

// Parse command-line arguments
program
  .option("--http [port]", "Start server with Streamable HTTP transport on specified port (default: 3000)")
  .option("--stdio", "Force stdio transport (default behavior)")
  .parse(process.argv);

const options = program.opts();

if (options.http !== undefined && options.stdio) {
  console.error("Cannot use --http and --stdio at the same time. Please choose one transport.");
  process.exit(1);
}

// Function to create and configure a new MCP server instance
const createMcpServer = () => {
  const server = new McpServer({
    name: "InfluxDB",
    version: "0.1.1",
  });

  // Register resources
  server.resource("orgs", "influxdb://orgs", listOrganizations);
  server.resource("buckets", "influxdb://buckets", listBuckets);
  server.resource(
    "bucket-measurements",
    new ResourceTemplate("influxdb://bucket/{bucketName}/measurements", {
      list: undefined,
    }),
    bucketMeasurements,
  );
  server.resource(
    "query",
    new ResourceTemplate("influxdb://query/{orgName}/{fluxQuery}", {
      list: undefined,
    }),
    executeQuery,
  );

  // Register tools
  server.tool(
    "write-data",
    {
      org: z.string().describe("The organization name"),
      bucket: z.string().describe("The bucket name"),
      data: z.string().describe("Data in InfluxDB line protocol format"),
      precision: z.enum(["ns", "us", "ms", "s"]).optional().describe(
        "Timestamp precision (ns, us, ms, s)",
      ),
    },
    writeData,
  );
  server.tool(
    "query-data",
    {
      org: z.string().describe("The organization name"),
      query: z.string().describe("Flux query string"),
    },
    queryData,
  );
  server.tool(
    "create-bucket",
    {
      name: z.string().describe("The bucket name"),
      orgID: z.string().describe("The organization ID"),
      retentionPeriodSeconds: z.number().optional().describe(
        "Retention period in seconds (optional)",
      ),
    },
    createBucket,
  );
  server.tool(
    "create-org",
    {
      name: z.string().describe("The organization name"),
      description: z.string().optional().describe(
        "Organization description (optional)",
      ),
    },
    createOrg,
  );

  // Register prompts
  server.prompt("flux-query-examples", {}, fluxQueryExamplesPrompt);
  server.prompt("line-protocol-guide", {}, lineProtocolGuidePrompt);

  return server;
};

// Create MCP server for stdio or as a template for HTTP
const globalServer = createMcpServer();


// Add a global error handler
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit - just log the error, as this could be caught and handled elsewhere
});

// Enhanced MCP protocol debugging
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Create special debugging functions for MCP protocol
function logMcpDebug(...args) {
  originalConsoleLog("[MCP-DEBUG]", ...args);
}

function logMcpError(...args) {
  originalConsoleError("[MCP-ERROR]", ...args);
}

// Enable extra protocol tracing for all requests/responses
// This debugging for globalServer.server is primarily for Stdio mode or if a global server instance were used.
// For HTTP mode, per-request server instances are created.
if (globalServer.server && !options.http) { // Only apply this if not in HTTP mode, or adjust as needed
  const originalOnMessage = globalServer.server.onmessage;
  globalServer.server.onmessage = function (message) {
    logMcpDebug("SERVER RECEIVED MESSAGE:", JSON.stringify(message));
    if (originalOnMessage) {
      return originalOnMessage.call(this, message);
    }
  };

  // Log server responses
  const originalSendResponse = globalServer.server._sendResponse;
  if (originalSendResponse) {
    globalServer.server._sendResponse = function (id, result) {
      logMcpDebug("SERVER SENDING RESPONSE:", JSON.stringify({ id, result }));
      return originalSendResponse.call(this, id, result);
    };
  }

  // Log server errors
  const originalSendError = globalServer.server._sendError;
  if (originalSendError) {
    globalServer.server._sendError = function (id, error) {
      logMcpDebug("SERVER SENDING ERROR:", JSON.stringify({ id, error }));
      return originalSendError.call(this, id, error);
    };
  }
}

// The rest of the debugging and connection logic will be handled differently
// for StdioServerTransport vs StreamableHTTPServerTransport.
// This will be addressed in the next step when setting up the Express server.

const useHttpTransport = options.http !== undefined;

if (!useHttpTransport) {
  // Start the server with stdio transport
  console.log("Starting MCP server with stdio transport...");
  const stdioTransport = new StdioServerTransport();

  // Add extra debugging to the stdioTransport
  if (stdioTransport._send) {
    const originalSend = stdioTransport._send;
    stdioTransport._send = function (data) {
      logMcpDebug("STDIO SENDING:", JSON.stringify(data));
      return originalSend.call(this, data);
    };
  }

  if (stdioTransport._receive) {
    const originalReceive = stdioTransport._receive;
    stdioTransport._receive = function (data) {
      logMcpDebug("STDIO RECEIVED:", JSON.stringify(data));
      return originalReceive.call(this, data);
    };
  }

  const originalStdioOnMessageCallback = stdioTransport.onmessage;
  stdioTransport.onmessage = function (message) {
    logMcpDebug("MESSAGE RECEIVED VIA STDIO:", JSON.stringify(message));
    if (originalStdioOnMessageCallback) {
      return originalStdioOnMessageCallback.call(this, message);
    }
  };

  // Check if we're in test mode
  const isTestMode = process.env.MCP_TEST_MODE === "true";
  if (isTestMode) {
    console.log("Running in test mode with enhanced protocol debugging for STDIO");

    // Add debugging for server methods
    const originalConnect = globalServer.connect;
    globalServer.connect = async function (transportInstance) {
      logMcpDebug("GlobalServer.connect() called with stdio transport");
      try {
        const result = await originalConnect.call(this, transportInstance);
        logMcpDebug("GlobalServer.connect() with stdio succeeded");
        return result;
      } catch (err) {
        logMcpError("GlobalServer.connect() with stdio failed:", err);
        throw err;
      }
    };
  }

  // Create a function to handle connection for stdio
  const connectStdioServer = async () => {
    try {
      console.log("Connecting global server to stdio transport...");
      await globalServer.connect(stdioTransport); // Use stdioTransport here
      console.log("Global server successfully connected to stdio transport");

      if (isTestMode) {
        if (!global.mcpHeartbeatInterval) {
          global.mcpHeartbeatInterval = setInterval(() => {
            if (!global.testCleanupInProgress) {
              console.log("[Heartbeat] MCP server (stdio) is still running...");
            }
          }, 3000);
          process.on("exit", () => {
            if (global.mcpHeartbeatInterval) {
              clearInterval(global.mcpHeartbeatInterval);
              global.mcpHeartbeatInterval = null;
            }
          });
        }
        if (globalServer.server) {
            globalServer.server.onclose = () => {
            logMcpError("STDIO SERVER CONNECTION CLOSED");
            if (global.mcpHeartbeatInterval) {
              clearInterval(global.mcpHeartbeatInterval);
              global.mcpHeartbeatInterval = null;
            }
          };
          globalServer.server.onerror = (err) => {
            logMcpError("STDIO SERVER ERROR:", err);
          };
        }
      }
    } catch (err) {
      console.error("Error starting MCP server with stdio:", err);
      process.exit(1);
    }
  };

  setTimeout(() => {
    connectStdioServer();
  }, 200);
} else {
  // Start the server with Streamable HTTP transport
  const app = express();
  app.use(express.json());

  const port = typeof options.http === 'string' ? parseInt(options.http, 10) : 3000;

  app.post('/mcp', async (req, res) => {
    // In stateless mode, create a new instance of transport and server for each request
    // to ensure complete isolation.
    logMcpDebug("HTTP POST /mcp received, creating new server and transport.");
    let server;
    let transport;
    try {
      server = createMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless
      });

      // Attach logger to the specific transport instance
      if (transport._send) {
        const originalSend = transport._send;
        transport._send = function (data) {
          logMcpDebug("HTTP SENDING:", JSON.stringify(data));
          return originalSend.call(this, data);
        };
      }
      if (transport._receive) {
        const originalReceive = transport._receive;
        transport._receive = function (data) {
          logMcpDebug("HTTP RECEIVED:", JSON.stringify(data));
          return originalReceive.call(this, data);
        };
      }
       const originalOnMessageCallback = transport.onmessage;
       transport.onmessage = function (message) {
         logMcpDebug("HTTP MESSAGE RECEIVED:", JSON.stringify(message));
         if (originalOnMessageCallback) {
           return originalOnMessageCallback.call(this, message);
         }
       };


      res.on('close', () => {
        logMcpDebug('HTTP POST /mcp request closed, cleaning up server and transport.');
        if (transport) transport.close();
        if (server) server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logMcpError('Error handling MCP HTTP request:', error);
      if (server) server.close(); // Ensure server is closed on error
      if (transport) transport.close(); // Ensure transport is closed on error
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: req.body?.id || null,
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    logMcpDebug('Received GET /mcp request');
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed for stateless transport."
      },
      id: null
    }));
  });

  app.delete('/mcp', async (req, res) => {
    logMcpDebug('Received DELETE /mcp request');
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed for stateless transport."
      },
      id: null
    }));
  });

  const httpServer = app.listen(port, () => {
    console.log(`MCP Streamable HTTP Server listening on port ${port}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: Port ${port} is already in use. Please choose a different port or free up port ${port}.`);
      process.exit(1);
    } else {
      console.error('Failed to start HTTP server:', err);
      process.exit(1);
    }
  });
}
