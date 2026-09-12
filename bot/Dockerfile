FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN chown -R node:node /app
USER node
# Only used in webhook mode (WEBHOOK_URL set -- see src/index.js). In polling mode (local
# dev / docker-compose) nothing listens on this port, so the health check is a no-op there
# instead of reporting a false "unhealthy".
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD sh -c 'if [ -z "$WEBHOOK_URL" ]; then exit 0; fi; wget -qO- "http://127.0.0.1:${PORT:-3001}/" >/dev/null || exit 1'
CMD ["node", "src/index.js"]
