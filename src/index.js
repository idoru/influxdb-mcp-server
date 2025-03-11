#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

// Create MCP server
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

// Start the server with stdio transport
console.log("Starting MCP server with stdio transport...");
const transport = new StdioServerTransport();

// Add extra debugging to the transport
if (transport._send) {
  const originalSend = transport._send;
  transport._send = function (data) {
    logMcpDebug("SENDING:", JSON.stringify(data));
    return originalSend.call(this, data);
  };
}

// If the transport has a _receive method, wrap it for debugging
if (transport._receive) {
  const originalReceive = transport._receive;
  transport._receive = function (data) {
    logMcpDebug("RECEIVED:", JSON.stringify(data));
    return originalReceive.call(this, data);
  };
}

// Enable extra protocol tracing for all requests/responses
if (server.server) {
  const originalOnMessage = server.server.onmessage;
  server.server.onmessage = function (message) {
    logMcpDebug("SERVER RECEIVED MESSAGE:", JSON.stringify(message));
    if (originalOnMessage) {
      return originalOnMessage.call(this, message);
    }
  };

  // Log server responses
  const originalSendResponse = server.server._sendResponse;
  if (originalSendResponse) {
    server.server._sendResponse = function (id, result) {
      logMcpDebug("SERVER SENDING RESPONSE:", JSON.stringify({ id, result }));
      return originalSendResponse.call(this, id, result);
    };
  }

  // Log server errors
  const originalSendError = server.server._sendError;
  if (originalSendError) {
    server.server._sendError = function (id, error) {
      logMcpDebug("SERVER SENDING ERROR:", JSON.stringify({ id, error }));
      return originalSendError.call(this, id, error);
    };
  }
}

// Override transport callbacks for debugging
const originalOnMessage = transport.onmessage;
transport.onmessage = function (message) {
  logMcpDebug("MESSAGE RECEIVED:", JSON.stringify(message));
  if (originalOnMessage) {
    return originalOnMessage.call(this, message);
  }
};

// Check if we're in test mode
const isTestMode = process.env.MCP_TEST_MODE === "true";
if (isTestMode) {
  console.log("Running in test mode with enhanced protocol debugging");

  // Add debugging for server methods
  const originalConnect = server.connect;
  server.connect = async function (transport) {
    logMcpDebug("Server.connect() called");
    try {
      const result = await originalConnect.call(this, transport);
      logMcpDebug("Server.connect() succeeded");
      return result;
    } catch (err) {
      logMcpError("Server.connect() failed:", err);
      throw err;
    }
  };
}

// Create a function to handle connection
const connectServer = async () => {
  try {
    console.log("Connecting server to transport...");
    await server.connect(transport);
    console.log("Server successfully connected to transport");

    // In test mode, perform extra validation
    if (isTestMode) {
      // Track heartbeat interval in global so it can be cleaned up
      if (!global.mcpHeartbeatInterval) {
        // Add a heartbeat timer to keep the connection alive during tests
        global.mcpHeartbeatInterval = setInterval(() => {
          // Only log if we're not in cleanup mode
          if (!global.testCleanupInProgress) {
            console.log("[Heartbeat] MCP server is still running...");
          }
        }, 3000);

        // Clean up the interval if the process exits
        process.on("exit", () => {
          if (global.mcpHeartbeatInterval) {
            clearInterval(global.mcpHeartbeatInterval);
            global.mcpHeartbeatInterval = null;
          }
        });
      }

      // Add extra hooks for protocol debugging
      server.server.onclose = () => {
        logMcpError("SERVER CONNECTION CLOSED");
        // Clear interval on connection close
        if (global.mcpHeartbeatInterval) {
          clearInterval(global.mcpHeartbeatInterval);
          global.mcpHeartbeatInterval = null;
        }
      };

      server.server.onerror = (err) => {
        logMcpError("SERVER ERROR:", err);
      };
    }
  } catch (err) {
    console.error("Error starting MCP server:", err);
    process.exit(1);
  }
};

// Connect with a small delay to ensure proper initialization
setTimeout(() => {
  connectServer();
}, 200);
