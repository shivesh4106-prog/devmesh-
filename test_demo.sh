#!/bin/bash
# DevMesh - Live Demo Test Script
# Run these commands AFTER the server is running and you've created an endpoint via the UI
# Replace <ENDPOINT_ID> with the actual ID shown in the UI

ENDPOINT_ID="${1:-REPLACE_WITH_ENDPOINT_ID}"
BASE_URL="http://localhost:3001"

echo "===================================================="
echo "   DevMesh Live Demo Test Script"
echo "   Endpoint ID: $ENDPOINT_ID"
echo "===================================================="

# ── TEST 1: Normal webhook event ──────────────────────────────────────────────
echo ""
echo "TEST 1: Normal GitHub-style webhook with HMAC signature"
echo "--------------------------------------------------------"
curl -X POST "$BASE_URL/api/v1/ingest/$ENDPOINT_ID" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -H "X-Hub-Signature-256: sha256=fake_signature_will_show_tampered" \
  -d '{
    "event": "push",
    "repository": {
      "name": "devmesh",
      "full_name": "org/devmesh",
      "private": false
    },
    "pusher": {
      "name": "john.doe",
      "email": "john@example.com"
    },
    "commits": [
      {
        "id": "abc123",
        "message": "feat: add chaos injection engine",
        "timestamp": "2026-10-13T03:00:00Z"
      }
    ],
    "ref": "refs/heads/main",
    "amount": 9999
  }'
echo ""

sleep 1

# ── TEST 2: Tampered/Unverified webhook with sensitive data ───────────────────
echo ""
echo "TEST 2: Webhook with sensitive data (will be REDACTED) + Schema Mutation"
echo "------------------------------------------------------------------------"
curl -X POST "$BASE_URL/api/v1/ingest/$ENDPOINT_ID" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: payment" \
  -d '{
    "event": "payment.completed",
    "user": {
      "email": "user@example.com",
      "password": "super_secret_123",
      "api_key": "sk_live_abc123xyz",
      "card_number": "4111-1111-1111-1111"
    },
    "authorization": "Bearer eyJhbGciOiJSUzI1NiJ9...",
    "amount": 299.99,
    "currency": "USD",
    "new_field_not_in_prev": "this causes schema drift!",
    "transaction_id": "txn_99887766"
  }'
echo ""

sleep 1

# ── TEST 3: Stripe-style HMAC webhook ─────────────────────────────────────────
echo ""
echo "TEST 3: Stripe-style webhook (provides Stripe-Signature header)"
echo "---------------------------------------------------------------"
curl -X POST "$BASE_URL/api/v1/ingest/$ENDPOINT_ID" \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1697123456,v1=tampered_signature_value_here" \
  -d '{
    "type": "invoice.payment_succeeded",
    "data": {
      "object": {
        "id": "in_1234567890",
        "customer": "cus_ABC123",
        "amount_paid": 4999,
        "currency": "usd",
        "status": "paid"
      }
    },
    "livemode": false
  }'
echo ""

echo "===================================================="
echo "   All 3 tests sent! Check the DevMesh Dashboard"
echo "   Open: http://localhost:5173"
echo "===================================================="
