# Một container phục vụ cả backend (API) lẫn frontend đã build.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY server server
COPY web web
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server --include-workspace-root=false
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
ENV PORT=8787 STATIC_DIR=../web/dist
EXPOSE 8787
USER node
WORKDIR /app/server
CMD ["node", "dist/index.js"]
