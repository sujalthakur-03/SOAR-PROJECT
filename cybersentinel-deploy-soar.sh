#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# CyberSentinel SOAR v3.0 — Deployment Script
# ══════════════════════════════════════════════════════════════════════════════
# Pulls Docker images from GHCR and deploys the full SOAR stack.
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

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: GitHub Token Validation
# ══════════════════════════════════════════════════════════════════════════════
step_validate_token() {
  separator
  log_info "Step 1/6 — Validating GitHub Token"

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
  log_info "Step 2/6 — Checking Docker & Docker Compose"

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
  log_info "Step 3/6 — Checking backend .env file"

  ENV_FILE="${DEPLOY_DIR}/backend/.env"

  if [ ! -f "$ENV_FILE" ]; then
    fail_exit "Missing ${ENV_FILE}. Create it before deploying. Required vars:
    JWT_SECRET, PORT, MONGODB_URI (optional, set via docker-compose),
    SOAR_API_KEY, and any connector API keys you need."
  fi

  log_ok "Found ${ENV_FILE}"

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
# Step 4: Login to GHCR & Pull Images
# ══════════════════════════════════════════════════════════════════════════════
step_pull_images() {
  separator
  log_info "Step 4/6 — Logging in to GHCR & pulling images"

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
# Step 5: Deploy with Docker Compose
# ══════════════════════════════════════════════════════════════════════════════
step_deploy() {
  separator
  log_info "Step 5/6 — Deploying CyberSentinel SOAR"

  cd "${DEPLOY_DIR}"

  # Stop existing containers if any
  log_info "Stopping existing containers (if any)..."
  ${COMPOSE_CMD} down --remove-orphans 2>/dev/null || true

  # Start all services
  log_info "Starting all services..."
  ${COMPOSE_CMD} up -d

  if [ $? -eq 0 ]; then
    log_ok "All containers started"
  else
    fail_exit "Failed to start containers. Check logs: ${COMPOSE_CMD} logs"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 6: Health Check & Summary
# ══════════════════════════════════════════════════════════════════════════════
step_verify() {
  separator
  log_info "Step 6/6 — Waiting for services to become healthy..."

  MAX_WAIT=60
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
  echo -e "${GREEN}${BOLD}  ╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}  ║       CyberSentinel SOAR v3.0 — Deployment Complete     ║${NC}"
  echo -e "${GREEN}${BOLD}  ╠══════════════════════════════════════════════════════════╣${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                          ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Frontend  → ${CYAN}http://${SERVER_IP}:3000${NC}                  ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Backend   → ${CYAN}http://${SERVER_IP}:3001${NC}                  ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Database  → ${CYAN}mongodb://${SERVER_IP}:27017${NC}              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                          ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Logs      → ${YELLOW}${COMPOSE_CMD} logs -f${NC}                  ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}  Stop      → ${YELLOW}${COMPOSE_CMD} down${NC}                     ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ║${NC}                                                          ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}  ╚══════════════════════════════════════════════════════════╝${NC}"
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
step_pull_images
step_deploy
step_verify

exit 0
