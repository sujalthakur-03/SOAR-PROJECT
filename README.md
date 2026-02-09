# CyberSentinel SOAR

**Security Orchestration, Automation, and Response Platform**

CyberSentinel is a full-stack SOAR platform for Security Operations Centers. It ingests security alerts from Wazuh (via a dedicated forwarder), matches them against user-defined playbooks, and executes automated response workflows — enrichment, conditional branching, human approval gates, containment actions, and notifications.

## Architecture

```
┌──────────────────────┐
│   Wazuh Manager      │
│   (Alert Source)     │
└─────────┬────────────┘
          │  Forwarder (Python, runs on Wazuh server)
          │  POST /api/webhooks/trigger/:playbookId/:secret
          ▼
┌──────────────────────────────────────────────────────────┐
│  soar-backend  (Node.js / Express)          port 3001   │
│  ─ Webhook ingestion & trigger evaluation               │
│  ─ Playbook execution engine (step-by-step)             │
│  ─ Connector integrations (VirusTotal, AbuseIPDB, …)    │
│  ─ Approval workflow management                         │
│  ─ REST API for frontend                                │
└─────────┬────────────────────────────────────────────────┘
          │  MongoDB (persistent storage)
          ▼
┌──────────────────────────────────────────────────────────┐
│  soar-database  (MongoDB 7.0)               port 27017  │
│  ─ Playbooks, Executions, Cases, Audit Logs             │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  soar-frontend  (React / TypeScript / Vite) port 3000   │
│  ─ Playbook manager & visual drag-and-drop editor       │
│  ─ Execution timeline (live updates)                    │
│  ─ Approval console                                     │
│  ─ Connector status, Audit log, SOC metrics dashboard   │
└──────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer     | Technology                                         |
|-----------|----------------------------------------------------|
| Frontend  | React 18, TypeScript, Vite, Tailwind CSS, ReactFlow, shadcn/ui |
| Backend   | Node.js 18, Express, Mongoose                     |
| Database  | MongoDB 7.0                                        |
| Forwarder | Python 3 (runs on the Wazuh server)                |
| Deployment| Docker Compose                                     |

## Prerequisites

- **Docker & Docker Compose** (recommended deployment)
- Or: Node.js 18+, MongoDB 7.0+ (for manual setup)
- A Wazuh server if you want real alert ingestion

## Quick Start (Docker)

```bash
git clone https://github.com/sujalthakur-03/SOAR-PROJECT.git
cd SOAR-PROJECT

# Create backend env file from the example
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys (see Environment section below)

# Build and start all services
docker compose up -d --build

# View logs
docker compose logs -f
```

Once running:

| Service  | URL                        |
|----------|----------------------------|
| Frontend | http://localhost:3000       |
| Backend  | http://localhost:3001       |
| MongoDB  | mongodb://localhost:27017   |

## Manual Setup (without Docker)

```bash
# Terminal 1 — Backend
cd backend
npm install
cp .env.example .env   # then edit .env
npm start              # listens on port 3001

# Terminal 2 — Frontend
npm install
npm run dev            # listens on port 3000
```

MongoDB must be running locally on the default port, or set `MONGODB_URI` in `backend/.env`.

## Environment Configuration

All backend configuration lives in `backend/.env`. Key variables:

```
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=cybersentinel

# Authentication
JWT_SECRET=<change-this>

# Wazuh Active Response (not used for alert ingestion)
WAZUH_API_URL=https://your-wazuh-server:55000
WAZUH_API_USERNAME=...
WAZUH_API_PASSWORD=...

# Threat Intelligence
VIRUSTOTAL_API_KEY=...
ABUSEIPDB_API_KEY=...

# Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...

# Firewall
FIREWALL_API_URL=...
FIREWALL_API_KEY=...

# Server
PORT=3001
NODE_ENV=production
```

See `backend/.env.example` for the full list with descriptions.

## Forwarder Setup

The **CyberSentinel Forwarder** is a lightweight Python script that runs on the Wazuh server. It reads alerts from Wazuh's `alerts.json` file in real time and forwards matching alerts to the SOAR backend's webhook endpoints.

It is deployed separately — not inside Docker Compose. See the `forwarder/` directory for its configuration and setup instructions.

## Creating a Playbook

1. Open the frontend at `http://localhost:3000`
2. Navigate to **Playbooks** in the sidebar
3. Click **Create Playbook** and use the visual drag-and-drop editor to define steps
4. Save the playbook — the backend automatically generates a webhook URL
5. Copy the webhook URL and configure it in the forwarder's routing rules

Alternatively, via the API:

```bash
# Create a playbook
curl -X POST http://localhost:3001/api/v2/playbooks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SSH Brute Force Response",
    "description": "Automated response to SSH brute force attacks",
    "trigger": {
      "type": "webhook",
      "conditions": { "rule_id": "5763", "severity": "high" }
    },
    "dsl": {
      "steps": [
        { "step_id": "enrich-1", "type": "enrichment", "connector": "abuseipdb", "action": "check_ip" },
        { "step_id": "cond-1", "type": "condition", "field": "enrich-1.abuse_score", "operator": "gt", "value": 80 },
        { "step_id": "action-1", "type": "action", "connector": "firewall", "action": "block_ip" },
        { "step_id": "notify-1", "type": "notification", "connector": "slack", "action": "send_message" }
      ]
    }
  }'

# Get the webhook URL from the response
# POST alerts to it:
curl -X POST http://localhost:3001/api/webhooks/trigger/<playbookId>/<secret> \
  -H "Content-Type: application/json" \
  -d '{ "rule": { "id": "5763" }, "data": { "srcip": "1.2.3.4" } }'
```

## Project Structure

```
SOAR-PROJECT/
├── src/                              # Frontend source
│   ├── components/
│   │   ├── views/                    # Dashboard views (Playbooks, Executions, etc.)
│   │   ├── playbook-editor/          # Visual drag-and-drop editor (ReactFlow)
│   │   ├── cases/                    # Case management components
│   │   ├── layout/                   # Sidebar, TopBar
│   │   └── ui/                       # shadcn/ui primitives
│   ├── hooks/                        # React Query hooks (usePlaybooks, useExecutions, …)
│   ├── lib/                          # API client, utilities
│   ├── types/                        # TypeScript type definitions
│   └── pages/                        # Route pages
├── backend/
│   └── src/
│       ├── models/                   # Mongoose schemas (playbook-v2, execution, case, …)
│       ├── routes/                   # Express route handlers
│       ├── services/                 # Business logic (execution engine, metrics, SLA, …)
│       ├── executors/                # Step executors (enrichment, action, notification)
│       ├── integrations/             # External API clients
│       └── index.js                  # Express app entry point
├── forwarder/                        # Python forwarder (deployed on Wazuh server)
├── docker-compose.yml                # Full-stack Docker deployment
├── Dockerfile                        # Frontend container
└── backend/Dockerfile                # Backend container
```

## API Endpoints

### Playbooks

| Method | Endpoint                           | Description              |
|--------|-------------------------------------|--------------------------|
| GET    | `/api/v2/playbooks`                 | List all playbooks       |
| POST   | `/api/v2/playbooks`                 | Create a playbook        |
| GET    | `/api/v2/playbooks/:id`             | Get playbook by ID       |
| PUT    | `/api/v2/playbooks/:id`             | Update a playbook        |
| DELETE | `/api/v2/playbooks/:id`             | Delete a playbook        |

### Webhooks & Executions

| Method | Endpoint                                         | Description                    |
|--------|--------------------------------------------------|--------------------------------|
| POST   | `/api/webhooks/trigger/:playbookId/:secret`       | Trigger playbook via webhook   |
| GET    | `/api/v1/executions`                              | List executions                |
| GET    | `/api/v1/executions/:id`                          | Get execution details          |
| GET    | `/api/v1/executions/stats`                        | Execution statistics           |

### Approvals, Cases, Metrics

| Method | Endpoint                       | Description                |
|--------|--------------------------------|----------------------------|
| GET    | `/api/v1/approvals`            | Pending approvals          |
| POST   | `/api/v1/approvals/:id/decide` | Approve / reject           |
| GET    | `/api/v1/cases`                | List cases                 |
| POST   | `/api/v1/cases`                | Create a case              |
| GET    | `/api/soc/kpis`                | SOC metrics & KPIs         |

### Health

| Method | Endpoint   | Description       |
|--------|------------|-------------------|
| GET    | `/health`  | Backend health check |

## License

MIT
