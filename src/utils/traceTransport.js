import { isDebugEnabled, logMcpDebug } from "./loggerConfig.js";

// Log every message a transport sends or receives when DEBUG=mcp:* is set.
// Must be called before server.connect(): the SDK chains any existing
// onmessage handler, and send() is looked up on the transport at call time.
export function traceTransport(transport, label) {
  if (!isDebugEnabled) return;

  const onmessage = transport.onmessage;
  transport.onmessage = (message, extra) => {
    logMcpDebug(`${label} RECEIVED:`, JSON.stringify(message));
    onmessage?.(message, extra);
  };

  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    logMcpDebug(`${label} SENDING:`, JSON.stringify(message));
    return send(message, options);
  };
}
