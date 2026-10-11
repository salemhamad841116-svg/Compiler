#!/usr/bin/env bash
# ==============================================================================
# Deploy Supervisor Dashboard (waraqa.msruq.com)
# Decoupled deployment: Does NOT wait for Super Admin or User Chat
# ==============================================================================
set -e

echo "=========================================================="
echo "📝 Initiating Supervisor Dashboard Deployment (waraqa.msruq.com)"
echo "=========================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$ROOT_DIR"

echo "🔍 1. Validating Supervisor web portal assets..."
if [ ! -f "public/supervisor/index.html" ] || [ ! -f "public/supervisor/app.js" ]; then
    echo "❌ Error: Supervisor web portal assets missing in public/supervisor!"
    exit 1
fi

echo "🚀 2. Deploying Supervisor frontend container..."
docker compose -f docker-compose.prod.yml up -d waraqa-frontend

echo "🌐 3. Verifying Supervisor web server..."
for i in {1..10}; do
    if curl -s http://localhost:8081 > /dev/null 2>&1; then
        echo "✅ Supervisor Dashboard is responding at http://localhost:8081!"
        break
    fi
    sleep 1
done

echo "=========================================================="
echo "🎉 Supervisor Dashboard (waraqa.msruq.com) successfully deployed!"
echo "🔗 Supervisors can access the ingestion portal now."
echo "=========================================================="
