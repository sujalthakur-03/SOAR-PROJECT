# CyberSentinel SOAR Backend

Backend execution engine for the CyberSentinel Security Orchestration, Automation, and Response (SOAR) platform.

## Overview

This backend service provides the core automation and orchestration capabilities for CyberSentinel:

- **Alert Ingestion**: Polls Wazuh for new security alerts and stores them in the database
- **Playbook Execution**: Automatically executes configured playbooks when alerts match trigger conditions
- **Step Execution**: Handles enrichment, conditions, approvals, actions, and notifications
- **External Integrations**: Connects to VirusTotal, AbuseIPDB, Slack, Email, Firewalls, and more

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Alert Ingestion                        │
│  Wazuh → Transform → Database → Trigger Matching         │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│                 Playbook Executor                        │
│  ┌───────────┐  ┌───────────┐  ┌────────────┐          │
│  │Enrichment │→ │ Condition │→ │  Approval  │          │
│  └───────────┘  └───────────┘  └────────────┘          │
│                        ↓                                 │
│  ┌───────────┐  ┌───────────────────────────┐          │
│  │  Action   │→ │     Notification          │          │
│  └───────────┘  └───────────────────────────┘          │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│              External Integrations                       │
│  VirusTotal | AbuseIPDB | Wazuh | Firewall              │
│  Slack | Email | CrowdStrike | Cortex XSOAR             │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js v18 or higher
- Access to Supabase database (configured in frontend)
- Wazuh server with API access
- API keys for external services (optional but recommended)

## Installation

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   nano .env
   ```

   **Required variables:**
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Service role key (NOT anon key)
   - `WAZUH_API_URL`: Your Wazuh server API endpoint
   - `WAZUH_API_USERNAME`: Wazuh API username
   - `WAZUH_API_PASSWORD`: Wazuh API password

   **Optional but recommended:**
   - `VIRUSTOTAL_API_KEY`: For file/URL/hash scanning
   - `ABUSEIPDB_API_KEY`: For IP reputation checking
   - `SLACK_WEBHOOK_URL`: For Slack notifications
   - `SMTP_*`: For email notifications
   - `FIREWALL_API_*`: For automated blocking

4. **Create logs directory:**
   ```bash
   mkdir -p logs
   ```

## Configuration Guide

### Getting Supabase Service Role Key

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **API**
3. Copy the **service_role** key (keep it secret!)
4. Add to `.env` file

### Wazuh Configuration

1. **Enable Wazuh API:**
   ```bash
   # On Wazuh server
   systemctl enable wazuh-api
   systemctl start wazuh-api
   ```

2. **Create API user:**
   ```bash
   # On Wazuh server
   /var/ossec/bin/wazuh-authd -u your_username -p your_password
   ```

3. **Test API access:**
   ```bash
   curl -k -u your_username:your_password \
     https://your-wazuh-server:55000/security/user/authenticate
   ```

### External API Keys

**VirusTotal:**
1. Sign up at https://www.virustotal.com/
2. Go to your profile → API Key
3. Copy the key and add to `.env`

**AbuseIPDB:**
1. Sign up at https://www.abuseipdb.com/
2. Go to Account → API
3. Generate an API key
4. Add to `.env`

**Slack:**
1. Create a Slack app at https://api.slack.com/apps
2. Enable Incoming Webhooks
3. Copy webhook URL and add to `.env`

## Running the Backend

### Development Mode (with auto-restart)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Using PM2 (recommended for production)
```bash
# Install PM2 globally
npm install -g pm2

# Start backend
pm2 start src/index.js --name cybersentinel-backend

# View logs
pm2 logs cybersentinel-backend

# Monitor
pm2 monit

# Stop
pm2 stop cybersentinel-backend

# Restart
pm2 restart cybersentinel-backend

# Set to start on boot
pm2 startup
pm2 save
```

## Verifying Installation

### 1. Check Backend Health
```bash
curl http://localhost:3001/health
```

Expected output:
```json
{
  "status": "healthy",
  "service": "CyberSentinel Backend",
  "version": "1.0.0",
  "timestamp": "2024-12-26T..."
}
```

### 2. Check Status
```bash
curl http://localhost:3001/status
```

Expected output:
```json
{
  "service": "CyberSentinel SOAR Backend",
  "status": "running",
  "database": "connected",
  "alertIngestion": "active",
  "uptime": 123.45,
  "timestamp": "2024-12-26T..."
}
```

### 3. Check Logs
```bash
tail -f logs/combined.log
```

You should see:
```
[info]: ✅ Database connection successful
[info]: 📡 Starting alert ingestion service...
[info]: 🔄 Starting alert ingestion service (polling every 10000ms)
[info]: ✅ Backend server running on port 3001
[info]: 🎯 CyberSentinel SOAR Backend is ready!
```

## Testing Alert Ingestion

### Option 1: Trigger a Wazuh Alert

1. SSH into a monitored agent
2. Trigger a test alert:
   ```bash
   # SSH brute force simulation
   for i in {1..10}; do ssh invalid_user@localhost; done
   ```

3. Check backend logs:
   ```bash
   tail -f logs/combined.log | grep "Alert ingested"
   ```

4. Check frontend: Open CyberSentinel UI → Live Alerts

### Option 2: Manual Alert Insertion (for testing)

```bash
# Insert test alert via Supabase SQL editor
INSERT INTO alerts (alert_id, rule_id, rule_name, severity, agent_id, agent_name, description, status)
VALUES ('TEST-001', '100002', 'SSH Brute Force Test', 'critical', 'agent-001', 'test-server', 'Test alert from backend', 'new');
```

## Testing Playbook Execution

1. **Create a test playbook in the UI:**
   - Go to Playbook Manager
   - Create new playbook
   - Set trigger: Source=CyberSentinel, Rule IDs=100002, Severity=high
   - Add step: Enrichment → AbuseIPDB → Check IP
   - Add step: Notification → Slack → #soc-alerts
   - Save and enable

2. **Trigger an alert that matches:**
   - Either wait for a real alert
   - Or insert a test alert with rule_id='100002'

3. **Monitor execution:**
   - Check backend logs for execution messages
   - Check frontend Execution Timeline view
   - Check Slack channel for notification

## Troubleshooting

### Database Connection Failed
```bash
# Check Supabase URL and key
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY

# Test connection manually
curl "$SUPABASE_URL/rest/v1/alerts?select=count" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

### Wazuh Connection Failed
```bash
# Check Wazuh API is running
systemctl status wazuh-api

# Test authentication
curl -k -u $WAZUH_API_USERNAME:$WAZUH_API_PASSWORD \
  $WAZUH_API_URL/security/user/authenticate

# Check firewall
sudo firewall-cmd --list-all
```

### No Alerts Being Ingested
```bash
# Check Wazuh has alerts
curl -k -u username:password \
  https://wazuh-server:55000/alerts?limit=10

# Check backend logs
tail -f logs/combined.log | grep -i wazuh

# Increase log verbosity
# In .env, set: LOG_LEVEL=debug
```

### API Integration Failing
```bash
# Test VirusTotal
curl --request GET \
  --url 'https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8' \
  --header 'x-apikey: YOUR_KEY'

# Test AbuseIPDB
curl --request GET \
  --url 'https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8' \
  --header 'Key: YOUR_KEY'

# Test Slack webhook
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test from CyberSentinel"}' \
  YOUR_WEBHOOK_URL
```

## File Structure

```
backend/
├── src/
│   ├── executors/
│   │   ├── enrichment.js     # Enrichment step executor
│   │   ├── condition.js      # Condition evaluator
│   │   ├── approval.js       # Approval handler
│   │   ├── action.js         # Action executor
│   │   └── notification.js   # Notification sender
│   ├── integrations/
│   │   ├── wazuh.js          # Wazuh API client
│   │   ├── virustotal.js     # VirusTotal API
│   │   ├── abuseipdb.js      # AbuseIPDB API
│   │   ├── slack.js          # Slack integration
│   │   ├── email.js          # Email/SMTP
│   │   └── firewall.js       # Firewall API
│   ├── services/
│   │   ├── alert-ingestion.js    # Alert polling service
│   │   └── playbook-executor.js  # Playbook execution engine
│   ├── utils/
│   │   ├── database.js       # Supabase client
│   │   ├── logger.js         # Winston logger
│   │   └── helpers.js        # Utility functions
│   ├── types/
│   │   └── index.js          # Type definitions
│   └── index.js              # Main entry point
├── logs/                     # Log files
├── .env                      # Environment variables
├── .env.example             # Example configuration
├── package.json             # Dependencies
└── README.md                # This file
```

## Security Considerations

1. **Never commit `.env` file** - It contains sensitive credentials
2. **Use service role key securely** - Only on backend, never in frontend
3. **Rotate API keys regularly** - Especially after exposure
4. **Enable HTTPS** - For production deployments
5. **Restrict network access** - Firewall rules for Wazuh, database
6. **Monitor logs** - Check for suspicious activity
7. **Keep dependencies updated** - Run `npm audit` regularly

## Performance Tuning

### Adjust Poll Interval
```env
# Default: 10 seconds
WAZUH_POLL_INTERVAL=10000

# High volume: 5 seconds
WAZUH_POLL_INTERVAL=5000

# Low volume: 30 seconds
WAZUH_POLL_INTERVAL=30000
```

### Concurrent Playbook Execution
Playbooks execute sequentially by default. For concurrent execution, modify `src/services/alert-ingestion.js`:

```javascript
// Execute all matching playbooks concurrently
await Promise.all(
  matchingPlaybooks.map(pb => executePlaybook(pb, alert))
);
```

## Monitoring & Logging

### Log Levels
- `error`: Critical errors
- `warn`: Warnings and non-critical issues
- `info`: General information (default)
- `debug`: Detailed debugging information

### Log Files
- `logs/error.log`: Errors only
- `logs/combined.log`: All logs

### View Logs
```bash
# Tail all logs
tail -f logs/combined.log

# Filter for errors
tail -f logs/error.log

# Search for specific alert
grep "ALT-001" logs/combined.log

# Monitor execution
tail -f logs/combined.log | grep -i execution
```

## Support

For issues, questions, or contributions:
- Check logs first: `tail -f logs/combined.log`
- Review this README
- Check Wazuh documentation: https://documentation.wazuh.com/
- Check Supabase docs: https://supabase.com/docs

## License

MIT License - See LICENSE file for details
