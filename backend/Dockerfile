FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
LABEL org.opencontainers.image.source="https://github.com/halitdundarr/studyvault-multicloud"
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/dist ./dist
USER appuser

EXPOSE 8080
CMD ["node", "dist/index.js"]
