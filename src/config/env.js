// Configuration from environment variables. Importing this module never
// throws; validateEnvironment() reports invalid settings and exits.
import { isLoopbackHost } from "./http.js";
import { readSecret } from "./secrets.js";

const configErrors = [];

// Strict boolean flags: anything other than "true"/"false" (or unset) is an
// error, so a typo such as INFLUXDB_READ_ONLY=1 cannot silently leave the
// write tools enabled.
function parseFlag(name, value) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  configErrors.push(`${name} must be "true" or "false"`);
  return false;
}

function parsePositiveInteger(name, value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  const number = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(number) || number < 1) {
    configErrors.push(`${name} must be a positive integer`);
    return fallback;
  }
  return number;
}

export const DEFAULT_INFLUXDB_URL = "http://localhost:8086";
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

// Validate an InfluxDB base URL and normalize it without a trailing slash.
// Only http(s) is accepted. Credentials, query strings and fragments are
// rejected; a path prefix (e.g. behind a reverse proxy) is kept. Error
// messages never echo the value, which may contain credentials.
export function parseInfluxUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("INFLUXDB_URL is not a valid URL. Expected e.g. http://localhost:8086");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("INFLUXDB_URL must use http:// or https://");
  }
  if (url.username || url.password) {
    throw new Error("INFLUXDB_URL must not contain credentials; use INFLUXDB_TOKEN instead");
  }
  if (url.search || url.hash || /[?#]/.test(value)) {
    throw new Error("INFLUXDB_URL must not contain a query string or fragment");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const rawInfluxUrl = process.env.INFLUXDB_URL || DEFAULT_INFLUXDB_URL;
let influxUrl;
try {
  influxUrl = parseInfluxUrl(rawInfluxUrl);
} catch (error) {
  configErrors.push(error.message);
  influxUrl = DEFAULT_INFLUXDB_URL;
}
export const INFLUXDB_URL = influxUrl;

let influxToken;
let influxTokenError = false;
try {
  influxToken = readSecret(process.env, "INFLUXDB_TOKEN");
} catch (error) {
  influxTokenError = true;
  configErrors.push(error.message);
}
export const INFLUXDB_TOKEN = influxToken;
export const DEFAULT_ORG = process.env.INFLUXDB_ORG;
export const DEFAULT_BUCKET = process.env.INFLUXDB_BUCKET;

// Largest InfluxDB response body the server will buffer, so one large query
// cannot exhaust memory
export const MAX_RESPONSE_BYTES = parsePositiveInteger(
  "INFLUXDB_MAX_RESPONSE_BYTES",
  process.env.INFLUXDB_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
);

// Omit the write and admin tools (write-data, create-bucket, create-org).
// The InfluxDB token's permissions are what actually enforce read-only access.
export const READ_ONLY = parseFlag("INFLUXDB_READ_ONLY", process.env.INFLUXDB_READ_ONLY);

// The query resource runs arbitrary Flux (which can write or make network
// requests) on a resource read, which clients may not gate behind an approval
// prompt, so it is opt-in.
export const ENABLE_QUERY_RESOURCE = parseFlag(
  "INFLUXDB_ENABLE_QUERY_RESOURCE",
  process.env.INFLUXDB_ENABLE_QUERY_RESOURCE,
);

// Check required environment variables
export function validateEnvironment() {
  const errors = [...configErrors];
  if (!INFLUXDB_TOKEN && !influxTokenError) {
    errors.unshift("INFLUXDB_TOKEN environment variable is required (or INFLUXDB_TOKEN_FILE)");
  }
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Error: ${error}`);
    }
    process.exit(1);
  }

  const { protocol, hostname } = new URL(INFLUXDB_URL);
  if (protocol === "http:" && !isLoopbackHost(hostname)) {
    console.warn(
      `INFLUXDB_URL uses plain http:// to ${hostname}; the InfluxDB token is sent unencrypted. Use https://.`,
    );
  }
}
