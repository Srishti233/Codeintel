FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm install --workspace apps/server --include-workspace-root
COPY apps/server apps/server
RUN npm -w apps/server run build

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/sql apps/server/sql
COPY --from=build /app/apps/server/package.json apps/server/
RUN mkdir -p /data/repos
EXPOSE 4000
