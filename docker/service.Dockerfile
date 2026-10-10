# Image générique : docker build --build-arg SERVICE=order -f docker/service.Dockerfile .
FROM node:22-alpine AS build
ARG SERVICE
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/common/package.json packages/common/
COPY services/${SERVICE}/package.json services/${SERVICE}/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=@sfmc/common --workspace=@sfmc/${SERVICE} --include-workspace-root
COPY packages/common packages/common
COPY services/${SERVICE} services/${SERVICE}
RUN npm run build -w @sfmc/common && npm run build -w @sfmc/${SERVICE}
RUN npm prune --omit=dev --workspace=@sfmc/common --workspace=@sfmc/${SERVICE} --include-workspace-root || true

FROM node:22-alpine
ARG SERVICE
ENV NODE_ENV=production SERVICE_DIR=services/${SERVICE}
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/common/package.json packages/common/package.json
COPY --from=build --chown=node:node /app/packages/common/dist packages/common/dist
COPY --from=build --chown=node:node /app/services/${SERVICE}/package.json services/${SERVICE}/package.json
COPY --from=build --chown=node:node /app/services/${SERVICE}/dist services/${SERVICE}/dist
USER node
EXPOSE 3000
CMD ["sh", "-c", "node ${SERVICE_DIR}/dist/main.js"]
