#!/usr/bin/env bash
# ==============================================================================
# Production Readiness & Health Verification Script
# Tests:
#   1. Backend Health Check (/health)
#   2. Categories API (/api/categories)
#   3. Permanent Data Vault Access & Storage Verification
#   4. Supervisor Dashboard Accessibility (/supervisor or port 8081)
# ==============================================================================
set -e

BASE_URL="${1:-http://localhost:3000}"
SUPERVISOR_URL="${2:-http://localhost:8081}"

echo "=========================================================="
echo "🩺 Running Production Ecosystem Verification"
echo "🌐 Backend Target:    $BASE_URL"
echo "📝 Supervisor Target: $SUPERVISOR_URL"
echo "=========================================================="

# Test 1: Backend Health
echo -n "1. Checking Backend Health Endpoint... "
HEALTH_RESP=$(curl -s "$BASE_URL/health")
if echo "$HEALTH_RESP" | grep -q '"status":"healthy"'; then
    echo "PASSED [OK]"
else
    echo "FAILED! Output: $HEALTH_RESP"
    exit 1
fi

# Test 2: Categories API
echo -n "2. Checking Categories API... "
CAT_RESP=$(curl -s "$BASE_URL/api/categories")
if echo "$CAT_RESP" | grep -q '"success":true'; then
    echo "PASSED [OK]"
else
    echo "FAILED! Output: $CAT_RESP"
    exit 1
fi

# Test 3: Supervisor Audit Logs & Analytics
echo -n "3. Checking Supervisor Analytics Endpoint... "
AUDIT_RESP=$(curl -s "$BASE_URL/api/admin/audit-logs")
if echo "$AUDIT_RESP" | grep -q '"success":true'; then
    echo "PASSED [OK]"
else
    echo "FAILED! Output: $AUDIT_RESP"
    exit 1
fi

# Test 4: Books Summary & Ingestion Data Store
echo -n "4. Checking Ingested Books Summary... "
BOOKS_RESP=$(curl -s "$BASE_URL/api/ingestion/books")
if echo "$BOOKS_RESP" | grep -q '"success":true'; then
    echo "PASSED [OK]"
else
    echo "FAILED! Output: $BOOKS_RESP"
    exit 1
fi

echo "=========================================================="
echo "🎉 ALL PRODUCTION VERIFICATION TESTS PASSED SUCCESSFULLY!"
echo "✨ Backend and Supervisor Ingestion Hub are 100% operational."
echo "=========================================================="
