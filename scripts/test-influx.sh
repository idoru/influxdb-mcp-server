#!/usr/bin/env bash
# Run the integration suites against a throwaway InfluxDB started with Docker
# Compose. Only this compose project's container is created and removed; the
# tests themselves never use the Docker API. Extra arguments go to Jest.
set -euo pipefail
cd "$(dirname "$0")/.."

compose=(docker compose -f docker-compose.test.yml -p influxdb-mcp-test)

export INFLUXDB_TEST_PORT="${INFLUXDB_TEST_PORT:-8086}"
export INFLUXDB_TEST_ORG="test-org"
INFLUXDB_TEST_ADMIN_TOKEN="$(openssl rand -hex 32)"
INFLUXDB_TEST_PASSWORD="$(openssl rand -hex 16)"
export INFLUXDB_TEST_ADMIN_TOKEN INFLUXDB_TEST_PASSWORD
export INFLUXDB_TEST_URL="http://127.0.0.1:${INFLUXDB_TEST_PORT}"

cleanup() {
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${compose[@]}" up --detach --wait
REQUIRE_INFLUX_TESTS=1 npm run test:integration -- "$@"
