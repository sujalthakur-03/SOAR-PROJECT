#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# CyberSentinel SOAR v3.0 — Deployment Script
# ══════════════════════════════════════════════════════════════════════════════
# Pulls Docker images from GHCR and deploys the full SOAR stack.
# Automatically finds open ports if defaults (3000/3001) are busy.
#
# Usage:
#   chmod +x cybersentinel-deploy-soar.sh
#   ./cybersentinel-deploy-soar.sh
#
# Environment:
#   GHCR_TOKEN  — GitHub PAT with read:packages scope (prompted if not set)
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

GHCR_ORG="cybersentinel-06"
IMAGES=(
  "ghcr.io/${GHCR_ORG}/cybersentinel-soar-frontend:latest"
  "ghcr.io/${GHCR_ORG}/cybersentinel-soar-backend:latest"
  "ghcr.io/${GHCR_ORG}/cybersentinel-soar-database:latest"
)

DEPLOY_DIR="/opt/cybersentinel-soar"

# Port defaults
FRONTEND_PORT=3000
BACKEND_PORT=3001

# ── Helper Functions ─────────────────────────────────────────────────────────

log_info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
log_ok()      { echo -e "${GREEN}[  OK]${NC}  $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_fail()    { echo -e "${RED}[FAIL]${NC}  $1"; }

separator() {
  echo -e "${BOLD}──────────────────────────────────────────────────────────────${NC}"
}

fail_exit() {
  log_fail "$1"
  exit 1
}

# Check if a port is available (not in use)
is_port_available() {
  local port=$1
  # Check with ss first, fall back to netstat, then /dev/tcp
  if command -v ss &>/dev/null; then
    ! ss -tlnH 2>/dev/null | grep -q ":${port} "
  elif command -v netstat &>/dev/null; then
    ! netstat -tlnp 2>/dev/null | grep -q ":${port} "
  else
    # Fallback: try to open a connection
    (echo >/dev/tcp/127.0.0.1/"${port}") 2>/dev/null && return 1 || return 0
  fi
}

# Find an available port within a given range
find_available_port() {
  local start=$1
  local end=$2
  local label=$3

  for port in $(seq "$start" "$end"); do
    if is_port_available "$port"; then
      echo "$port"
      return 0
    fi
  done

  fail_exit "No available port found for ${label} in range ${start}-${end}"
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: GitHub Token Validation
# ══════════════════════════════════════════════════════════════════════════════
step_validate_token() {
  separator
  log_info "Step 1/8 — Validating GitHub Token"

  if [ -z "${GHCR_TOKEN:-}" ]; then
    echo -en "${CYAN}Enter your GitHub PAT (with read:packages scope): ${NC}"
    read -rs GHCR_TOKEN
    echo
  fi

  if [ -z "${GHCR_TOKEN}" ]; then
    fail_exit "No token provided. Set GHCR_TOKEN or enter it when prompted."
  fi

  # Validate token against GitHub API
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: token ${GHCR_TOKEN}" \
    "https://api.github.com/user")

  if [ "$HTTP_CODE" -eq 200 ]; then
    GH_USER=$(curl -s -H "Authorization: token ${GHCR_TOKEN}" \
      "https://api.github.com/user" | grep -o '"login" *: *"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    log_ok "Token valid — authenticated as ${BOLD}${GH_USER}${NC}"
  elif [ "$HTTP_CODE" -eq 401 ]; then
    fail_exit "Token is invalid or expired (HTTP 401). Please check your PAT."
  elif [ "$HTTP_CODE" -eq 403 ]; then
    fail_exit "Token lacks required permissions (HTTP 403). Ensure read:packages scope."
  else
    fail_exit "GitHub API returned HTTP ${HTTP_CODE}. Check your network/token."
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Check Docker & Docker Compose
# ══════════════════════════════════════════════════════════════════════════════
step_check_docker() {
  separator
  log_info "Step 2/8 — Checking Docker & Docker Compose"

  # Check Docker
  if ! command -v docker &>/dev/null; then
    fail_exit "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
  fi

  DOCKER_VERSION=$(docker --version 2>/dev/null | head -1)
  log_ok "Docker found — ${DOCKER_VERSION}"

  # Check if Docker daemon is running
  if ! docker info &>/dev/null; then
    fail_exit "Docker daemon is not running. Start it with: sudo systemctl start docker"
  fi
  log_ok "Docker daemon is running"

  # Check Docker Compose (v2 plugin or v1 standalone)
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
    COMPOSE_VERSION=$(docker compose version 2>/dev/null | head -1)
    log_ok "Docker Compose (v2) found — ${COMPOSE_VERSION}"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
    COMPOSE_VERSION=$(docker-compose --version 2>/dev/null | head -1)
    log_ok "Docker Compose (v1) found — ${COMPOSE_VERSION}"
  else
    fail_exit "Docker Compose is not installed. Install it from https://docs.docker.com/compose/install/"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Check .env File
# ══════════════════════════════════════════════════════════════════════════════
step_check_env() {
  separator
  log_info "Step 3/8 — Checking backend .env file"

  # Ensure deploy directory and backend subdirectory exist
  mkdir -p "${DEPLOY_DIR}/backend"

  ENV_FILE="${DEPLOY_DIR}/backend/.env"

  if [ ! -f "$ENV_FILE" ]; then
    log_warn "No .env found at ${ENV_FILE} — generating default configuration..."

    # Generate a random JWT secret
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')

    # Generate a random SOAR API key
    SOAR_API_KEY=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')

    cat > "$ENV_FILE" << ENVEOF
# ══════════════════════════════════════════════════════════════
# CyberSentinel SOAR v3.0 — Backend Environment Configuration
# Auto-generated by cybersentinel-deploy-soar.sh
# ══════════════════════════════════════════════════════════════

# ── Core ──
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h
SOAR_API_KEY=${SOAR_API_KEY}
PORT=3001
NODE_ENV=production

# ── MongoDB (overridden by docker-compose in Docker mode) ──
MONGODB_URI=mongodb://soar-database:27017
MONGODB_DB_NAME=cybersentinel

# ── CyberSentinel Control Plane API ──
# Used for active response actions (block IP, manage CDB lists, etc.)
CYBERSENTINEL_CONTROL_PLANE_URL=
CYBERSENTINEL_CONTROL_PLANE_USER=
CYBERSENTINEL_CONTROL_PLANE_PASSWORD=

# ── VirusTotal API (threat enrichment) ──
VIRUSTOTAL_API_KEY=

# ── AbuseIPDB API (IP reputation) ──
ABUSEIPDB_API_KEY=

# ── AlienVault OTX API (threat intelligence) ──
ALIENVAULT_OTX_API_KEY=

# ── Slack Integration ──
SLACK_WEBHOOK_URL=
SLACK_BOT_TOKEN=

# ── Email (SMTP) ──
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=

# ── Firewall API (generic) ──
FIREWALL_API_URL=
FIREWALL_API_KEY=

# ── Webhook Security ──
WEBHOOK_TRUSTED_IPS=127.0.0.1,::1,::ffff:127.0.0.1

# ── CORS ──
CORS_ORIGIN=http://localhost:3000

# ── Legacy (disabled) ──
ENABLE_ALERT_STORAGE=false
ENABLE_ALERT_ENRICHMENT=false
ENABLE_PLAYBOOK_MATCHING=false
ENABLE_LEGACY_PULL_INGESTION=false
ENVEOF

    log_ok "Created ${ENV_FILE} with auto-generated secrets"
    log_info "JWT_SECRET and SOAR_API_KEY have been randomly generated"
    log_warn "Edit ${ENV_FILE} to add your connector API keys (VirusTotal, SMTP, etc.)"
  else
    log_ok "Found ${ENV_FILE}"
  fi

  # Check critical variables
  MISSING_VARS=()

  if ! grep -q "^JWT_SECRET=" "$ENV_FILE" 2>/dev/null; then
    MISSING_VARS+=("JWT_SECRET")
  else
    JWT_VAL=$(grep "^JWT_SECRET=" "$ENV_FILE" | cut -d'=' -f2-)
    if [ "$JWT_VAL" = "cybersentinel_jwt_secret_key_change_in_production_2024" ]; then
      log_warn "JWT_SECRET is using the default value — change it for production!"
    fi
  fi

  if ! grep -q "^PORT=" "$ENV_FILE" 2>/dev/null; then
    MISSING_VARS+=("PORT")
  fi

  if ! grep -q "^SOAR_API_KEY=" "$ENV_FILE" 2>/dev/null; then
    MISSING_VARS+=("SOAR_API_KEY")
  fi

  if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    log_warn "Missing recommended env vars: ${MISSING_VARS[*]}"
  else
    log_ok "All critical env vars present"
  fi

  # Check optional connectors
  OPTIONAL_CONFIGURED=0
  for KEY in VIRUSTOTAL_API_KEY ABUSEIPDB_API_KEY ALIENVAULT_OTX_API_KEY SMTP_HOST SLACK_WEBHOOK_URL; do
    VAL=$(grep "^${KEY}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- || true)
    if [ -n "$VAL" ] && [[ "$VAL" != your_* ]] && [[ "$VAL" != https://hooks.slack.com/services/YOUR* ]]; then
      OPTIONAL_CONFIGURED=$((OPTIONAL_CONFIGURED + 1))
    fi
  done
  log_info "${OPTIONAL_CONFIGURED}/5 optional connectors configured (VirusTotal, AbuseIPDB, AlienVault, SMTP, Slack)"
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Find Available Ports
# ══════════════════════════════════════════════════════════════════════════════
step_find_ports() {
  separator
  log_info "Step 4/8 — Checking port availability"

  # ── Frontend port (range: 3000-3010) ──
  if is_port_available 3000; then
    FRONTEND_PORT=3000
    log_ok "Frontend port 3000 is available"
  else
    log_warn "Port 3000 is in use — scanning range 3000-3010..."
    FRONTEND_PORT=$(find_available_port 3000 3010 "frontend")
    log_ok "Frontend will use port ${BOLD}${FRONTEND_PORT}${NC}"
  fi

  # ── Backend port (range: 3011-3020) ──
  if is_port_available 3001; then
    BACKEND_PORT=3001
    log_ok "Backend port 3001 is available"
  else
    log_warn "Port 3001 is in use — scanning range 3011-3020..."
    BACKEND_PORT=$(find_available_port 3011 3020 "backend")
    log_ok "Backend will use port ${BOLD}${BACKEND_PORT}${NC}"
  fi

  export FRONTEND_PORT
  export BACKEND_PORT

  log_info "Port assignment: Frontend=${BOLD}${FRONTEND_PORT}${NC}  Backend=${BOLD}${BACKEND_PORT}${NC}"
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Login to GHCR & Pull Images
# ══════════════════════════════════════════════════════════════════════════════
step_setup_deploy_dir() {
  separator
  log_info "Step 5/8 — Setting up deploy directory"

  mkdir -p "${DEPLOY_DIR}"

  REPO_NAME="CyberSentinel-SOAR"
  REPO_URL="https://${GHCR_TOKEN}@github.com/${GHCR_ORG}/${REPO_NAME}.git"
  NEED_FETCH=false

  # Check what we need to fetch
  [ ! -f "${DEPLOY_DIR}/docker-compose.yml" ] && NEED_FETCH=true
  [ ! -d "${DEPLOY_DIR}/forwarder" ] && NEED_FETCH=true

  if [ "$NEED_FETCH" = false ]; then
    log_ok "docker-compose.yml already exists in ${DEPLOY_DIR}"
    log_ok "forwarder/ directory already exists in ${DEPLOY_DIR}"
  else
    log_info "Fetching docker-compose.yml and forwarder/ from repo (sparse checkout)..."

    TEMP_DIR=$(mktemp -d)
    trap "rm -rf ${TEMP_DIR}" EXIT

    # Initialize a bare sparse checkout — only pulls docker-compose.yml + forwarder/
    cd "${TEMP_DIR}"
    git init -q
    git remote add origin "${REPO_URL}"
    git config core.sparseCheckout true

    # Only checkout these paths
    mkdir -p .git/info
    cat > .git/info/sparse-checkout << 'SPARSE'
docker-compose.yml
forwarder/
SPARSE

    git pull --depth 1 origin main -q 2>/dev/null || \
      fail_exit "Failed to fetch from repo. Check token permissions."

    # Copy docker-compose.yml (don't overwrite if it exists)
    if [ ! -f "${DEPLOY_DIR}/docker-compose.yml" ] && [ -f "docker-compose.yml" ]; then
      cp docker-compose.yml "${DEPLOY_DIR}/"
      log_ok "Fetched docker-compose.yml"
    else
      log_ok "docker-compose.yml already present — skipped"
    fi

    # Copy forwarder directory (don't overwrite existing routing_rules.yaml)
    if [ -d "forwarder" ]; then
      mkdir -p "${DEPLOY_DIR}/forwarder"

      # Copy all forwarder files, preserving user-modified routing_rules.yaml
      for file in forwarder/*; do
        BASENAME=$(basename "$file")
        TARGET="${DEPLOY_DIR}/forwarder/${BASENAME}"

        if [ "$BASENAME" = "routing_rules.yaml" ] && [ -f "$TARGET" ]; then
          log_info "Preserving existing routing_rules.yaml (not overwritten)"
        elif [ "$BASENAME" = ".env" ] && [ -f "$TARGET" ]; then
          log_info "Preserving existing forwarder/.env (not overwritten)"
        else
          cp "$file" "$TARGET"
        fi
      done

      # Ensure .env.example is always copied as reference
      [ -f "forwarder/.env.example" ] && cp "forwarder/.env.example" "${DEPLOY_DIR}/forwarder/.env.example"

      log_ok "Fetched forwarder/ directory"
    fi

    # Cleanup
    cd "${DEPLOY_DIR}"
    rm -rf "${TEMP_DIR}"
    trap - EXIT
  fi

  # Show what's in the deploy directory
  log_info "Deploy directory contents:"
  echo "    ${DEPLOY_DIR}/"
  echo "    ├── docker-compose.yml"
  echo "    ├── backend/"
  echo "    │   └── .env"
  echo "    └── forwarder/"
  if [ -d "${DEPLOY_DIR}/forwarder" ]; then
    for f in "${DEPLOY_DIR}/forwarder/"*; do
      [ -f "$f" ] && echo "        ├── $(basename "$f")"
    done
  fi
}

step_pull_images() {
  separator
  log_info "Step 6/8 — Logging in to GHCR & pulling images"

  echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_ORG}" --password-stdin 2>/dev/null
  if [ $? -eq 0 ]; then
    log_ok "Logged in to ghcr.io"
  else
    fail_exit "Failed to login to GHCR. Check your token has read:packages scope."
  fi

  for IMAGE in "${IMAGES[@]}"; do
    log_info "Pulling ${IMAGE}..."
    if docker pull "${IMAGE}" 2>&1 | tail -1; then
      log_ok "Pulled ${IMAGE}"
    else
      fail_exit "Failed to pull ${IMAGE}"
    fi
  done
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 6: Deploy with Docker Compose
# ══════════════════════════════════════════════════════════════════════════════
step_deploy() {
  separator
  log_info "Step 7/8 — Deploying CyberSentinel SOAR"

  cd "${DEPLOY_DIR}"

  # Stop existing containers if any
  log_info "Stopping existing containers (if any)..."
  ${COMPOSE_CMD} down --remove-orphans 2>/dev/null || true

  # Rebuild frontend if backend port changed (bakes VITE_BACKEND_PORT into JS bundle)
  if [ "$BACKEND_PORT" != "3001" ]; then
    log_info "Backend port changed to ${BACKEND_PORT} — rebuilding frontend image..."
    VITE_BACKEND_PORT="${BACKEND_PORT}" ${COMPOSE_CMD} build soar-frontend
  fi

  # Start all services with port env vars
  log_info "Starting all services (Frontend:${FRONTEND_PORT}, Backend:${BACKEND_PORT})..."
  FRONTEND_PORT="${FRONTEND_PORT}" BACKEND_PORT="${BACKEND_PORT}" ${COMPOSE_CMD} up -d

  if [ $? -eq 0 ]; then
    log_ok "All containers started"
  else
    fail_exit "Failed to start containers. Check logs: ${COMPOSE_CMD} logs"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 7: Health Check & Summary
# ══════════════════════════════════════════════════════════════════════════════
step_verify() {
  separator
  log_info "Step 8/8 — Waiting for services to become healthy..."

  MAX_WAIT=90
  ELAPSED=0
  ALL_HEALTHY=false

  while [ $ELAPSED -lt $MAX_WAIT ]; do
    DB_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' soar-database 2>/dev/null || echo "missing")
    BE_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' soar-backend 2>/dev/null || echo "missing")
    FE_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' soar-frontend 2>/dev/null || echo "missing")

    if [ "$DB_HEALTH" = "healthy" ] && [ "$BE_HEALTH" = "healthy" ] && [ "$FE_HEALTH" = "healthy" ]; then
      ALL_HEALTHY=true
      break
    fi

    echo -ne "\r  Waiting... DB=${DB_HEALTH} | Backend=${BE_HEALTH} | Frontend=${FE_HEALTH} (${ELAPSED}s/${MAX_WAIT}s)"
    sleep 5
    ELAPSED=$((ELAPSED + 5))
  done

  echo ""

  if [ "$ALL_HEALTHY" = true ]; then
    log_ok "All services are healthy!"
  else
    log_warn "Not all services healthy after ${MAX_WAIT}s. Check logs:"
    log_warn "  ${COMPOSE_CMD} logs soar-database"
    log_warn "  ${COMPOSE_CMD} logs soar-backend"
    log_warn "  ${COMPOSE_CMD} logs soar-frontend"
  fi

  # Get server IP
  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

  separator
  echo ""
  echo -e "${GREEN}${BOLD}  ╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}  ║         CyberSentinel SOAR v3.0 — Deployment Complete       ║${NC}"
  echo -e "${GREEN}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Frontend  → ${CYAN}http://${SERVER_IP}:${FRONTEND_PORT}${NC}$(printf '%*s' $((24 - ${#SERVER_IP} - ${#FRONTEND_PORT})) '')${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Backend   → ${CYAN}http://${SERVER_IP}:${BACKEND_PORT}${NC}$(printf '%*s' $((24 - ${#SERVER_IP} - ${#BACKEND_PORT})) '')${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Database  → ${CYAN}mongodb://${SERVER_IP}:27017${NC}$(printf '%*s' $((21 - ${#SERVER_IP})) '')${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Logs      → ${YELLOW}${COMPOSE_CMD} logs -f${NC}$(printf '%*s' $((32 - ${#COMPOSE_CMD})) '')${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Stop      → ${YELLOW}${COMPOSE_CMD} down${NC}$(printf '%*s' $((35 - ${#COMPOSE_CMD})) '')${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  ${BOLD}How to Create a User:${NC}                                       ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  ${BOLD}Default accounts:${NC}                                           ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}    soaradmin / CyberSentinelSOAR@2026  (role: admin)                       ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}    analyst / analyst123   (role: analyst)                     ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  ${BOLD}Step 1:${NC} Get admin JWT token:                                 ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}    curl -X POST http://${SERVER_IP}:${BACKEND_PORT}/auth/login \\       ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}      -H 'Content-Type: application/json' \\                   ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}      -d '{\"username\":\"soaradmin\",\"password\":\"CyberSentinelSOAR@2026\"}'              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  ${BOLD}Step 2:${NC} Create new user (admin token required):              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}    curl -X POST http://${SERVER_IP}:${BACKEND_PORT}/auth/register \\    ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}      -H 'Content-Type: application/json' \\                   ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}      -H 'Authorization: Bearer <TOKEN>' \\                    ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}      -d '{\"username\":\"john\",\"password\":\"SecurePass1!\",        ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}           \"fullName\":\"John Doe\",\"role\":\"analyst\",              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}           \"email\":\"john@example.com\"}'                        ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  ${BOLD}Roles:${NC} admin, analyst                                      ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}  CyberSentinel SOAR v3.0 — Deployment Script${NC}"
echo ""

step_validate_token
step_check_docker
step_check_env
step_find_ports
step_setup_deploy_dir
step_pull_images
step_deploy
step_verify

exit 0
