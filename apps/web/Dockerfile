FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm install --workspace apps/web --include-workspace-root
COPY apps/web apps/web
RUN npm -w apps/web run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
EXPOSE 3000
ENV HOSTNAME=0.0.0.0 PORT=3000
CMD ["node", "apps/web/server.js"]
