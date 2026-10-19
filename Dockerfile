# CI builds dist/, server-dist/ and live-update/ from the same commit first.
# Keep that verified Android bundle when packaging the runtime image.
FROM node:22-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY dist ./dist
COPY server-dist ./server-dist
COPY live-update ./live-update
ARG APP_VERSION=unknown
ENV APP_VERSION=$APP_VERSION
USER node
EXPOSE 8080
CMD ["node", "server-dist/server.cjs"]
