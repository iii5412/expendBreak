# Runtime image for Cloud Run. The deploy workflow builds dist/, server-dist/
# and live-update/ first (see .github/workflows/deploy.yml); this only packages them.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY dist ./dist
COPY server-dist ./server-dist
COPY live-update ./live-update

ARG APP_VERSION=unknown
ENV APP_VERSION=$APP_VERSION

USER node
CMD ["node", "server-dist/server.cjs"]
