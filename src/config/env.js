// Configuration from environment variables
export const INFLUXDB_URL = process.env.INFLUXDB_URL || "http://localhost:8086";
export const INFLUXDB_TOKEN = process.env.INFLUXDB_TOKEN;
export const DEFAULT_ORG = process.env.INFLUXDB_ORG;
export const DEFAULT_BUCKET = process.env.INFLUXDB_BUCKET;

// Check required environment variables
export function validateEnvironment() {
  if (!INFLUXDB_TOKEN) {
    console.error("Error: INFLUXDB_TOKEN environment variable is required");
    process.exit(1);
  }
}
