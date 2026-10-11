# ==============================================================================
# Production Dockerfile for Private Gemini RAG Backend & Data Vault
# ==============================================================================

FROM node:20-alpine AS base

# Install security updates and dumb-init for proper process signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application source code and web assets
COPY src/ ./src/
COPY public/ ./public/

# Create persistent storage directories with appropriate permissions
RUN mkdir -p /app/data/vault /app/uploads && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    chown -R nodejs:nodejs /app/data /app/uploads

# Declare persistent volume mount for production data lake & vector store
VOLUME ["/app/data"]

# Switch to unprivileged user
USER nodejs

# Environment defaults
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    DATA_VAULT_PATH=/app/data/vault \
    VECTOR_DB_PATH=/app/data/vector_store.json \
    CATEGORIES_FILE_PATH=/app/data/categories.json

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
