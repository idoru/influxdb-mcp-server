// Quote a value as a Flux string literal. Backslashes, double quotes and
// "${" (string interpolation) are escaped so the value cannot alter the query.
export function fluxString(value) {
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$\{/g, "\\${");
  return `"${escaped}"`;
}

// Decode a percent-encoded URI template variable. The MCP SDK passes matched
// template variables through without decoding them.
export function decodeUriParam(name, value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Invalid percent-encoding in ${name}`);
  }
}
