# Build and run the paid research-tools MCP server.
FROM node:22-slim AS build
WORKDIR /app
# better-sqlite3 is a native module. A prebuild usually exists, but if it does
# not the image build must not fail: the example still offers SQLite as the
# zero-config local default even though deployment runs on Postgres.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY examples ./examples
RUN npm ci
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
# No VOLUME directive: Railway rejects it and manages persistence itself.
#
# It is not needed here anyway. Set DATABASE_URL and the server uses Postgres,
# which is the only way entitlements survive a container being replaced. The
# SQLite path below is the local fallback; if you run this image under plain
# Docker *without* DATABASE_URL, mount a volume at /data yourself or a redeploy
# takes people's credits with it.
ENV TOLLBOOTH_DB=/data/tollbooth.sqlite
EXPOSE 8080
CMD ["node", "examples/research-tools/dist/http.js"]
