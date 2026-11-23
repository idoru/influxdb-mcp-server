# Dockerfile for InfluxDB MCP Server
# Base image pinned by digest (node:26-alpine, multi-arch index) so builds are
# reproducible; update the tag and digest together.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

ENV NODE_ENV=production

WORKDIR /app

# Install production dependencies only; none of them need install scripts
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy source code (owned by root, so the runtime user cannot modify it)
COPY src ./src

# Run as the unprivileged user provided by the base image
USER node

# Entrypoint for MCP server (using stdio transport). For HTTP inside a
# container, pass e.g. `--http 3000 --host 0.0.0.0` and set MCP_AUTH_TOKEN.
ENTRYPOINT ["node", "src/index.js"]
