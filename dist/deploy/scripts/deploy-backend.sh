#!/usr/bin/env bash
# ==============================================================================
# Deploy Backend API & Permanent Data Vault Service
# ==============================================================================
set -e

echo "=========================================================="
echo "🚀 Initiating Backend API & Permanent Data Vault Deployment"
echo "=========================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$ROOT_DIR"

# Verify .env.production exists or copy from example
if [ ! -f ".env.production" ]; then
    echo "⚠️ .env.production not found! Copying from .env.example..."
    cp .env.example .env.production
fi

echo "📦 1. Building production Docker container..."
docker build -t masruq-rag-backend:latest -f Dockerfile .

echo "🗄️ 2. Ensuring persistent Data Vault volume..."
docker volume create masruq_rag_production_vault_data

echo "🚢 3. Launching Backend & Data Vault with docker-compose..."
docker compose -f docker-compose.prod.yml up -d rag-backend

echo "⏳ 4. Waiting for Backend service to report healthy..."
for i in {1..15}; do
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        echo "✅ Backend API is online and healthy!"
        break
    fi
    sleep 2
done

echo "=========================================================="
echo "🎉 Backend API & Permanent Data Vault successfully deployed!"
echo "🌐 API Endpoint: http://localhost:3000 / https://api.msruq.com"
echo "=========================================================="
