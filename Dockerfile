# ==============================================================================
# Production Dockerfile for the Private RAG Backend & Data Vault (open-source AI)
# ==============================================================================

FROM node:22-alpine AS base

# dumb-init: proper process signal handling.
# Phase 5 local AI tools (all open source, run inside this container):
#   tesseract-ocr (+ Arabic/English data) - local OCR engine / fallback for the vision model
#   poppler-utils (pdftoppm, pdfinfo)     - renders scanned PDF pages to images for OCR
#   ffmpeg                                - audio extraction/splitting for Whisper, image re-encoding
RUN apk add --no-cache dumb-init tesseract-ocr tesseract-ocr-data-ara tesseract-ocr-data-eng poppler-utils ffmpeg openjpeg-tools imagemagick \
    && tesseract --list-langs

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application source code and web assets
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

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
