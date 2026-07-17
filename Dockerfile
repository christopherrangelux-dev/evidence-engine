# Evidence Engine — single small Node image. No build step: the app runs
# straight from TypeScript via tsx (a runtime dependency), the same way
# `npm start` runs it locally. Kept deliberately minimal for a fast cold start,
# since the Fly deploy scales to zero and boots on demand.

FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
# Fly routes to this port (see internal_port in fly.toml); the server reads PORT.
ENV PORT=8080

# Install only production deps first so this layer caches across code changes.
# tsx lives in `dependencies`, so the runtime is present; typescript/vitest
# (devDependencies) are omitted.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source. evals/ and docs/ are intentionally left out — not needed at runtime.
COPY core ./core
COPY mcp-server ./mcp-server
COPY demo-client ./demo-client

EXPOSE 8080
CMD ["npm", "start"]
