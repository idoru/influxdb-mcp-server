import { createRequire } from "node:module";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Import config
import { DEFAULT_ORG, DEFAULT_BUCKET } from "./config/env.js";

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

const { version } = createRequire(import.meta.url)("../package.json");

// Params backed by an env default are optional; otherwise keep them required so
// the advertised schema matches what the handler will actually accept
const withEnvDefault = (schema, envDefault) =>
  envDefault ? schema.optional() : schema;

// Create and configure a new MCP server instance
export const createMcpServer = () => {
  const server = new McpServer({
    name: "InfluxDB",
    version,
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
    `Stream newline-delimited line protocol records into a bucket. Use this after composing measurements so the LLM can insert real telemetry, optionally controlling timestamp precision.${DEFAULT_ORG ? ` Default org: "${DEFAULT_ORG}".` : ""}${DEFAULT_BUCKET ? ` Default bucket: "${DEFAULT_BUCKET}".` : ""}`,
    {
      org: withEnvDefault(
        z
          .string()
          .describe(
            `Human-readable organization name that owns the destination bucket (the same value returned by the orgs resource).${DEFAULT_ORG ? ` Defaults to "${DEFAULT_ORG}" if omitted.` : ""}`,
          ),
        DEFAULT_ORG,
      ),
      bucket: withEnvDefault(
        z
          .string()
          .describe(
            `Bucket name to receive the points.${DEFAULT_BUCKET ? ` Defaults to "${DEFAULT_BUCKET}" if omitted.` : " Make sure it already exists or call create-bucket first."}`,
          ),
        DEFAULT_BUCKET,
      ),
      data: z
        .string()
        .describe(
          "Payload containing one or more line protocol lines (measurements, tags, fields, timestamps) separated by newlines.",
        ),
      precision: z
        .enum(["ns", "us", "ms", "s"])
        .optional()
        .describe(
          "Optional timestamp precision. Provide it only when the line protocol omits unit suffix context; defaults to nanoseconds.",
        ),
    },
    writeData,
  );
  server.tool(
    "query-data",
    `Execute a Flux query inside an organization to inspect measurement schemas, run aggregations, or validate recently written data.${DEFAULT_ORG ? ` Default org: "${DEFAULT_ORG}".` : ""}`,
    {
      org: withEnvDefault(
        z
          .string()
          .describe(
            `Organization whose buckets the query should target (exact name, not ID).${DEFAULT_ORG ? ` Defaults to "${DEFAULT_ORG}" if omitted.` : ""}`,
          ),
        DEFAULT_ORG,
      ),
      query: z
        .string()
        .describe(
          "Flux query text. Multi-line strings are supported; results are returned as annotated CSV for easy parsing.",
        ),
    },
    queryData,
  );
  server.tool(
    "create-bucket",
    "Provision a new bucket under an organization so that subsequent write-data calls have a destination.",
    {
      name: z
        .string()
        .describe(
          "Friendly bucket name. Follow InfluxDB naming rules (alphanumeric, dashes, underscores).",
        ),
      orgID: z
        .string()
        .describe(
          "Organization ID (UUID) that will own the bucket. Retrieve it from the organizations resource or create-org output.",
        ),
      retentionPeriodSeconds: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Optional retention duration expressed in whole seconds. Omit (or pass 0) for infinite retention.",
        ),
    },
    createBucket,
  );
  server.tool(
    "create-org",
    "Create a brand-new organization to isolate users or projects before generating buckets and tokens.",
    {
      name: z
        .string()
        .describe(
          "Display name for the organization as it should appear in InfluxDB Cloud/OSS.",
        ),
      description: z
        .string()
        .optional()
        .describe(
          "Optional free-form description that helps humans understand why the org exists.",
        ),
    },
    createOrg,
  );

  // Register prompts
  server.prompt("flux-query-examples", {}, fluxQueryExamplesPrompt);
  server.prompt("line-protocol-guide", {}, lineProtocolGuidePrompt);

  return server;
};
