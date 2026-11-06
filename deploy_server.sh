#!/bin/bash
set -e

echo "=========================================================="
echo "    Deploying Engineer App Builder Platform (Production)   "
echo "=========================================================="

if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed. Please install Docker and Docker Compose."
    exit 1
fi

echo "[1/4] Stopping existing containers..."
docker compose -f docker-compose.prod.yml down --remove-orphans || true

echo "[2/4] Building and launching production services..."
docker compose -f docker-compose.prod.yml up -d --build

echo "[3/4] Verifying service statuses..."
sleep 4
docker compose -f docker-compose.prod.yml ps

echo "[4/4] Deployment finished successfully!"
echo "----------------------------------------------------------"
echo "Access Points:"
echo " - Engineer App Builder: https://engineer.misruq.co"
echo " - Admin Control Panel:  https://admin.misruq.com"
echo " - Backend REST API:     http://localhost:3000/api"
echo "=========================================================="
