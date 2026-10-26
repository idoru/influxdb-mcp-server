import { format } from "node:util";

// Redirect console.log and console.error to stderr to avoid interfering with MCP protocol messages
// MCP uses stdout for protocol communication
export function configureLogger() {
  console.log = (...args) => {
    process.stderr.write("[INFO] " + format(...args) + "\n");
  };

  console.error = (...args) => {
    process.stderr.write("[ERROR] " + format(...args) + "\n");
  };

  console.warn = (...args) => {
    process.stderr.write("[WARN] " + format(...args) + "\n");
  };
}

// Verbose MCP protocol tracing (full message bodies, including query text and
// written data) is opt-in via DEBUG=mcp:* (or DEBUG=mcp / DEBUG=*)
export const isDebugEnabled = (process.env.DEBUG || "")
  .split(/[\s,]+/)
  .some((pattern) => pattern === "*" || pattern === "mcp" || pattern.startsWith("mcp:"));

export function logMcpDebug(...args) {
  if (isDebugEnabled) {
    console.log("[MCP-DEBUG]", ...args);
  }
}
