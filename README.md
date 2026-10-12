# ⚡ DevMesh — Real-Time Webhook Inspector & Chaos Engineering Platform

> High-throughput webhook ingestion, cryptographic HMAC verification, automated sensitive data redaction, real-time schema mutation/drift detection, and chaos failure simulation.

---

## 🌟 Overview

**DevMesh** is an open-source, developer-first observability and testing platform built specifically for webhook infrastructures (GitHub, Stripe, Shopify, Auth0, custom webhooks). It decouples high-speed HTTP ingestion from database writes via in-memory buffering, provides sub-second live streaming over WebSockets, detects breaking schema changes between consecutive payloads, and includes a **Chaos Replay Studio** to simulate latency, rate limiting, and timeout failures.

---

## 🚀 Key Features

### 1. ⚡ High-Throughput Ingestion & Async Buffering
- Ingest endpoint: `POST /api/v1/ingest/:endpointId`
- Immediate `202 Accepted` response with unique `traceId` within single-digit milliseconds (~4-6ms).
- In-memory event queue with automated 100ms async drainer to MySQL database via Prisma ORM.

### 2. 🛡️ Cryptographic HMAC Verification
- Real-time signature verification for standard webhook providers:
  - **GitHub**: `X-Hub-Signature-256` (SHA-256 HMAC)
  - **Stripe**: `Stripe-Signature` (Timestamped `t=<ts>,v1=<sig>` payload verification)
  - **Generic**: `X-Signature`
- Automatic status classification: `VERIFIED` (Green), `TAMPERED` (Red), or `UNVERIFIED` (Gray).

### 3. 🔒 Automated Sensitive Data Redaction
- Zero-leak policy: auto-detects and masks credentials, passwords, tokens, API keys, card numbers, and authorization headers (`[REDACTED]`).
- Toggle between **Redacted** view (safe for logs & UI sharing) and **Raw** view in the Inspector.

### 4. 🧬 Schema Drift & Mutation Detection
- Compares each incoming payload against the most recent event on the same endpoint.
- Pinpoints:
  - **Added fields** (e.g., `+ new_feature_flag`)
  - **Removed fields** (e.g., `- deprecated_id`)
  - **Type mutations** (e.g., `~ amount: number → string`)

### 5. 🔬 In-App Webhook Simulator
- Simulate realistic webhooks directly from the UI without terminal commands:
  - **GitHub Push**: Commits, repo metadata, pusher info
  - **Stripe Payment**: Invoices, customer objects, sensitive credentials
  - **Shopify Orders**: Line items, pricing, order states
  - **Auth0 Signup**: Token and credentials test
  - **Schema Drift Demo**: Automatically triggers schema mutation
- Configurable signature behavior: *Unverified*, *Valid HMAC* (computed using Web Crypto API), or *Tampered HMAC*.

### 6. 🌪️ Chaos & Replay Studio
- Forward captured events to custom target endpoints (e.g., `http://localhost:3000/webhook`, `https://webhook.site`).
- **Artificial Latency Injection**: 0 to 5,000ms delay slider.
- **Simulated Failure Modes**:
  - `Connection Timeout`: Simulates upstream network drop
  - `Rate Limit (429)`: Simulates upstream throttling
  - `Gateway Timeout (504)`: Simulates gateway delays
- **Edit Before Replay**: Modify payload JSON in-place before replaying to test edge cases or bug fixes.
- Full execution audit log with status code, roundtrip latency, and response preview.

### 7. 💻 Instant Code Generation & Payload Diff
- Generates reproduction snippets in **cURL**, **Node.js (fetch)**, and **Python (requests)** with exact headers and payload.
- Side-by-side **Payload Diff Comparator** to contrast any two captured events.
- Single-click export of payloads or full endpoint event logs as JSON.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express 5, TypeScript, Socket.io, Prisma ORM, MySQL
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons
- **Database**: MySQL 8.0 (indexed on endpoints, events, and replay logs)

---

## 🏁 Getting Started

### Prerequisites
- Node.js (v18+)
- MySQL (v8.0+) running locally on port 3306 with database `devmesh`

### 1. Database Setup
```bash
# In server directory
cd server
npx prisma db push
```

### 2. Run the Application
Open two terminals (or run the root scripts):

**Terminal 1 (Backend Server — Port 3001):**
```bash
cd server
npm run dev
```

**Terminal 2 (Frontend Client — Port 5173):**
```bash
cd client
npm run dev
```

Open your browser at **[http://localhost:5173](http://localhost:5173)**.

---

## 🧪 Automated Live Demo Script

You can run automated test webhooks directly to see events stream live into the dashboard:

**PowerShell (Windows):**
```powershell
.\test_demo.ps1
```

**Bash / Linux / macOS:**
```bash
./test_demo.sh <ENDPOINT_ID>
```

---

## 📡 API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Backend landing & status dashboard |
| `GET` | `/health` / `/api/v1/health` | Service health status check |
| `POST` | `/api/v1/ingest/:endpointId` | High-speed webhook ingest (returns 202) |
| `GET` | `/api/v1/endpoints` | List all webhook endpoints |
| `POST` | `/api/v1/endpoints` | Create endpoint (`name`, `hmacSecret`) |
| `DELETE` | `/api/v1/endpoints/:id` | Delete endpoint |
| `GET` | `/api/v1/events/endpoint/:endpointId` | List events for an endpoint |
| `GET` | `/api/v1/events/:id` | Get event details with replay history |
| `GET` | `/api/v1/events/:id/snippets` | Generate cURL, Node.js, Python snippets |
| `DELETE` | `/api/v1/events/:id` | Delete single event |
| `DELETE` | `/api/v1/events/endpoint/:endpointId` | Clear all events for an endpoint |
| `POST` | `/api/v1/replay/:eventId` | Replay event with chaos injection |
| `GET` | `/api/v1/replay/logs/:eventId` | Get replay execution logs |

---

## 📄 License
MIT
