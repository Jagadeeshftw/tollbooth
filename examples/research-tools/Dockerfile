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
# The SQLite database holds entitlements people have paid for. Mount a volume
# here, or a redeploy takes their credits with it.
VOLUME /data
ENV TOLLBOOTH_DB=/data/tollbooth.sqlite
EXPOSE 8080
CMD ["node", "examples/research-tools/dist/http.js"]
