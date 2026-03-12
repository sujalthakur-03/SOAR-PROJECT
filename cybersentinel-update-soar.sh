#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# CyberSentinel SOAR v3.0 — Update Script
# ══════════════════════════════════════════════════════════════════════════════
# Pulls latest Docker images from GHCR and redeploys if any image has changed.
# Works on any server — no source code or git needed, only Docker + GHCR.
#
# Usage:
#   chmod +x cybersentinel-update-soar.sh
#   ./cybersentinel-update-soar.sh
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
DEPLOY_DIR="/opt/cybersentinel-soar"
REPO_NAME="CyberSentinel-SOAR"

IMAGES=(
  "ghcr.io/${GHCR_ORG}/cybersentinel-soar-frontend:latest"
  "ghcr.io/${GHCR_ORG}/cybersentinel-soar-backend:latest"
  "ghcr.io/${GHCR_ORG}/cybersentinel-soar-database:latest"
)

# Track what changed
IMAGES_UPDATED=()

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

# Get short image name from full GHCR path
short_name() {
  echo "$1" | sed 's|ghcr.io/.*/||; s|:latest||'
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Authenticate
# ══════════════════════════════════════════════════════════════════════════════
step_authenticate() {
  separator
  log_info "Step 1/5 — Authenticating"

  if [ -z "${GHCR_TOKEN:-}" ]; then
    echo -en "${CYAN}Enter your GitHub PAT (with read:packages scope): ${NC}"
    read -rs GHCR_TOKEN
    echo
  fi

  [ -z "${GHCR_TOKEN}" ] && fail_exit "No token provided."

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: token ${GHCR_TOKEN}" \
    "https://api.github.com/user")

  if [ "$HTTP_CODE" -eq 200 ]; then
    GH_USER=$(curl -s -H "Authorization: token ${GHCR_TOKEN}" \
      "https://api.github.com/user" | grep -o '"login" *: *"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    log_ok "Authenticated as ${BOLD}${GH_USER}${NC}"
  else
    fail_exit "Token invalid (HTTP ${HTTP_CODE})"
  fi

  # Login to GHCR
  echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_ORG}" --password-stdin 2>/dev/null
  log_ok "Logged in to GHCR"
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Pre-flight checks
# ══════════════════════════════════════════════════════════════════════════════
step_preflight() {
  separator
  log_info "Step 2/5 — Pre-flight checks"

  # Check Docker
  command -v docker &>/dev/null || fail_exit "Docker not installed"
  docker info &>/dev/null || fail_exit "Docker daemon not running"
  log_ok "Docker is running"

  # Check Docker Compose
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    fail_exit "Docker Compose not installed"
  fi
  log_ok "Docker Compose available"

  # Check deploy directory and docker-compose.yml
  if [ ! -d "${DEPLOY_DIR}" ]; then
    fail_exit "${DEPLOY_DIR} does not exist. Run cybersentinel-deploy-soar.sh first."
  fi

  if [ ! -f "${DEPLOY_DIR}/docker-compose.yml" ]; then
    log_warn "docker-compose.yml missing — pulling from repo..."
    command -v git &>/dev/null || fail_exit "Git not installed (needed to fetch docker-compose.yml)"
    REPO_URL="https://${GHCR_TOKEN}@github.com/${GHCR_ORG}/${REPO_NAME}.git"
    git clone --depth 1 "${REPO_URL}" /tmp/cs-update 2>/dev/null || fail_exit "Failed to clone repo"
    cp /tmp/cs-update/docker-compose.yml "${DEPLOY_DIR}/"
    cp /tmp/cs-update/cybersentinel-update-soar.sh "${DEPLOY_DIR}/" 2>/dev/null || true
    cp /tmp/cs-update/cybersentinel-deploy-soar.sh "${DEPLOY_DIR}/" 2>/dev/null || true
    rm -rf /tmp/cs-update
    log_ok "docker-compose.yml fetched"
  fi

  log_ok "Deploy directory: ${DEPLOY_DIR}"

  # Show currently running containers
  RUNNING=$(docker ps --format "{{.Names}}" --filter "name=soar-" 2>/dev/null | sort | tr '\n' ', ' | sed 's/,$//')
  if [ -n "$RUNNING" ]; then
    log_info "Running containers: ${RUNNING}"
  else
    log_warn "No CyberSentinel containers currently running"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Pull latest images & detect changes
# ══════════════════════════════════════════════════════════════════════════════
step_pull_images() {
  separator
  log_info "Step 3/5 — Pulling latest images from GHCR"

  for IMAGE in "${IMAGES[@]}"; do
    NAME=$(short_name "$IMAGE")

    # Get current local digest (if image exists)
    OLD_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null | cut -d@ -f2 || echo "none")

    # Pull latest
    log_info "Pulling ${BOLD}${NAME}${NC}..."
    docker pull "$IMAGE" 2>&1 | tail -1

    # Get new digest
    NEW_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null | cut -d@ -f2 || echo "unknown")

    if [ "$OLD_DIGEST" = "none" ]; then
      log_ok "${NAME} — ${GREEN}new image pulled${NC}"
      IMAGES_UPDATED+=("$NAME")
    elif [ "$OLD_DIGEST" != "$NEW_DIGEST" ]; then
      log_ok "${NAME} — ${YELLOW}updated${NC} (digest changed)"
      IMAGES_UPDATED+=("$NAME")
    else
      log_ok "${NAME} — already up to date"
    fi
  done

  echo ""
  if [ ${#IMAGES_UPDATED[@]} -eq 0 ]; then
    log_ok "All images are already up to date"
  else
    log_info "Updated images: ${BOLD}${IMAGES_UPDATED[*]}${NC}"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Redeploy containers
# ══════════════════════════════════════════════════════════════════════════════
step_redeploy() {
  separator
  log_info "Step 4/5 — Redeploying services"

  if [ ${#IMAGES_UPDATED[@]} -eq 0 ]; then
    log_ok "No image changes — skipping redeploy"
    log_info "To force redeploy, run: ${YELLOW}${COMPOSE_CMD} up -d --force-recreate${NC}"
    return
  fi

  cd "${DEPLOY_DIR}"

  # Preserve current port assignments from running containers
  FRONTEND_PORT=$(docker port soar-frontend 3000 2>/dev/null | cut -d: -f2 || echo "3000")
  BACKEND_PORT=$(docker port soar-backend 3001 2>/dev/null | cut -d: -f2 || echo "3001")
  [ -z "$FRONTEND_PORT" ] && FRONTEND_PORT=3000
  [ -z "$BACKEND_PORT" ] && BACKEND_PORT=3001

  export FRONTEND_PORT BACKEND_PORT

  # Stop and remove old containers
  log_info "Stopping current containers..."
  ${COMPOSE_CMD} down --remove-orphans 2>/dev/null || true
  docker rm -f soar-frontend soar-backend soar-database 2>/dev/null || true

  # Start fresh with new images
  log_info "Starting updated services (Frontend:${FRONTEND_PORT}, Backend:${BACKEND_PORT})..."
  FRONTEND_PORT="${FRONTEND_PORT}" BACKEND_PORT="${BACKEND_PORT}" ${COMPOSE_CMD} up -d

  if [ $? -eq 0 ]; then
    log_ok "All containers started"
  else
    fail_exit "Failed to start containers. Run: ${COMPOSE_CMD} logs"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Health check & summary
# ══════════════════════════════════════════════════════════════════════════════
step_verify() {
  separator
  log_info "Step 5/5 — Health check"

  # Skip health check if nothing was redeployed
  if [ ${#IMAGES_UPDATED[@]} -eq 0 ]; then
    log_ok "No changes — nothing to verify"
    echo ""
    echo -e "${GREEN}${BOLD}  All images are already at the latest version.${NC}"
    echo ""
    return
  fi

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

  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
  UPDATED_LIST="${IMAGES_UPDATED[*]}"

  if [ "$ALL_HEALTHY" = true ]; then
    separator
    echo ""
    echo -e "${GREEN}${BOLD}  ╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}  ║          CyberSentinel SOAR — Update Complete                ║${NC}"
    echo -e "${GREEN}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}  Updated  → ${CYAN}${UPDATED_LIST}${NC}$(printf '%*s' $((40 - ${#UPDATED_LIST})) '' 2>/dev/null)${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}  Status   → ${GREEN}All services healthy${NC}                            ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}  Frontend → ${CYAN}http://${SERVER_IP}:${FRONTEND_PORT}${NC}$(printf '%*s' $((24 - ${#SERVER_IP} - ${#FRONTEND_PORT})) '' 2>/dev/null)${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}  Backend  → ${CYAN}http://${SERVER_IP}:${BACKEND_PORT}${NC}$(printf '%*s' $((24 - ${#SERVER_IP} - ${#BACKEND_PORT})) '' 2>/dev/null)${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
  else
    log_warn "Not all services healthy after ${MAX_WAIT}s"
    log_warn "  ${COMPOSE_CMD} logs soar-backend"
    log_warn "  ${COMPOSE_CMD} logs soar-frontend"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}  CyberSentinel SOAR v3.0 — Update Script${NC}"
echo ""

step_authenticate
step_preflight
step_pull_images
step_redeploy
step_verify

exit 0
