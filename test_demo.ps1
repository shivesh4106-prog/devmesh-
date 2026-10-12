# DevMesh - Live Demo Test Script for PowerShell
# Usage: .\test_demo.ps1 [ENDPOINT_ID]
param (
    [string]$EndpointId = ""
)

$BaseUrl = "http://localhost:3001"

if (-not $EndpointId) {
    Write-Host "Fetching first active endpoint from server..." -ForegroundColor Cyan
    try {
        $endpoints = Invoke-RestMethod -Uri "$BaseUrl/api/v1/endpoints" -Method Get
        if ($endpoints.Count -gt 0) {
            $EndpointId = $endpoints[0].id
            Write-Host "Auto-selected endpoint: $($endpoints[0].name) ($EndpointId)" -ForegroundColor Green
        } else {
            Write-Host "No endpoint found! Creating a demo endpoint..." -ForegroundColor Yellow
            $created = Invoke-RestMethod -Uri "$BaseUrl/api/v1/endpoints" -Method Post -Body (@{ name = "Demo Webhooks"; hmacSecret = "demo_secret_xyz" } | ConvertTo-Json) -ContentType "application/json"
            $EndpointId = $created.id
            Write-Host "Created endpoint: $($created.name) ($EndpointId)" -ForegroundColor Green
        }
    } catch {
        Write-Host "Failed to connect to DevMesh server on $BaseUrl. Is it running?" -ForegroundColor Red
        exit 1
    }
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "   DevMesh Live Demo Test Script (PowerShell)" -ForegroundColor Cyan
Write-Host "   Endpoint ID: $EndpointId" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# ── TEST 1: GitHub Push Webhook ───────────────────────────────────────────────
Write-Host "`nTEST 1: GitHub Push Webhook (with HMAC Signature)" -ForegroundColor Yellow
$body1 = @{
    event = "push"
    repository = @{
        name = "devmesh"
        full_name = "org/devmesh"
        private = $false
    }
    pusher = @{
        name = "john.doe"
        email = "john@example.com"
    }
    commits = @(
        @{
            id = "abc123"
            message = "feat: add chaos injection engine"
            timestamp = (Get-Date).ToString("o")
        }
    )
    ref = "refs/heads/main"
    amount = 9999
} | ConvertTo-Json -Depth 5

$headers1 = @{
    "X-GitHub-Event" = "push"
    "X-Hub-Signature-256" = "sha256=fake_signature_will_show_tampered"
}

$resp1 = Invoke-RestMethod -Uri "$BaseUrl/api/v1/ingest/$EndpointId" -Method Post -Body $body1 -Headers $headers1 -ContentType "application/json"
Write-Host "Result: Accepted = $($resp1.accepted), Trace = $($resp1.traceId), HMAC = $($resp1.hmacStatus)" -ForegroundColor Green

Start-Sleep -Seconds 1

# ── TEST 2: Sensitive Data & Schema Mutation ─────────────────────────────────
Write-Host "`nTEST 2: Webhook with sensitive credentials (will be REDACTED) + Schema Drift" -ForegroundColor Yellow
$body2 = @{
    event = "payment.completed"
    user = @{
        email = "user@example.com"
        password = "super_secret_password_123"
        api_key = "sk_live_abc123xyz"
        card_number = "4111-1111-1111-1111"
    }
    authorization = "Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
    amount = 299.99
    currency = "USD"
    new_field_not_in_prev = "this causes schema drift!"
    transaction_id = "txn_99887766"
} | ConvertTo-Json -Depth 5

$headers2 = @{
    "X-GitHub-Event" = "payment"
}

$resp2 = Invoke-RestMethod -Uri "$BaseUrl/api/v1/ingest/$EndpointId" -Method Post -Body $body2 -Headers $headers2 -ContentType "application/json"
Write-Host "Result: Accepted = $($resp2.accepted), Trace = $($resp2.traceId), Drift = $($resp2.hasSchemaMutation)" -ForegroundColor Green

Start-Sleep -Seconds 1

# ── TEST 3: Stripe-style Webhook ─────────────────────────────────────────────
Write-Host "`nTEST 3: Stripe-style invoice payment succeeded webhook" -ForegroundColor Yellow
$body3 = @{
    type = "invoice.payment_succeeded"
    data = @{
        object = @{
            id = "in_1234567890"
            customer = "cus_ABC123"
            amount_paid = 4999
            currency = "usd"
            status = "paid"
        }
    }
    livemode = $false
} | ConvertTo-Json -Depth 5

$headers3 = @{
    "Stripe-Signature" = "t=1697123456,v1=tampered_signature_value_here"
}

$resp3 = Invoke-RestMethod -Uri "$BaseUrl/api/v1/ingest/$EndpointId" -Method Post -Body $body3 -Headers $headers3 -ContentType "application/json"
Write-Host "Result: Accepted = $($resp3.accepted), Trace = $($resp3.traceId)" -ForegroundColor Green

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "   All 3 tests sent! Check the DevMesh Dashboard" -ForegroundColor Green
Write-Host "   Open: http://localhost:5173" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
