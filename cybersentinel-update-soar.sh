#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# CyberSentinel SOAR v3.0 — Update Script
# ══════════════════════════════════════════════════════════════════════════════
# Pulls latest changes from the GitHub repo and redeploys updated services.
# Only rebuilds images for services that actually changed.
#
# Usage:
#   chmod +x cybersentinel-update-soar.sh
#   ./cybersentinel-update-soar.sh
#
# Environment:
#   GHCR_TOKEN  — GitHub PAT with repo + read:packages scope (prompted if not set)
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
REPO_NAME="CyberSentinel-SOAR"
DEPLOY_DIR="/opt/cybersentinel-soar"

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
# Step 1: Authenticate
# ══════════════════════════════════════════════════════════════════════════════
step_authenticate() {
  separator
  log_info "Step 1/6 — Authenticating"

  if [ -z "${GHCR_TOKEN:-}" ]; then
    echo -en "${CYAN}Enter your GitHub PAT: ${NC}"
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
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Pre-flight checks
# ══════════════════════════════════════════════════════════════════════════════
step_preflight() {
  separator
  log_info "Step 2/6 — Pre-flight checks"

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

  # Check git
  command -v git &>/dev/null || fail_exit "Git not installed"
  log_ok "Git available"

  # Check deploy directory
  if [ ! -d "${DEPLOY_DIR}" ]; then
    fail_exit "${DEPLOY_DIR} does not exist. Run cybersentinel-deploy-soar.sh first."
  fi
  log_ok "Deploy directory: ${DEPLOY_DIR}"
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Pull latest code from repo
# ══════════════════════════════════════════════════════════════════════════════
step_pull_code() {
  separator
  log_info "Step 3/6 — Pulling latest code from GitHub"

  cd "${DEPLOY_DIR}"

  REPO_URL="https://${GHCR_TOKEN}@github.com/${GHCR_ORG}/${REPO_NAME}.git"

  # If not a git repo yet, clone it
  if [ ! -d ".git" ]; then
    log_info "No git repo found — cloning fresh..."
    cd /tmp
    rm -rf "${REPO_NAME}-update"
    git clone --depth 1 "${REPO_URL}" "${REPO_NAME}-update" 2>/dev/null || \
      fail_exit "Failed to clone repo"

    # Copy new files without overwriting backend/.env
    rsync -a --exclude='backend/.env' "${REPO_NAME}-update/" "${DEPLOY_DIR}/"
    rm -rf "${REPO_NAME}-update"
    cd "${DEPLOY_DIR}"
    log_ok "Fresh clone applied to ${DEPLOY_DIR}"
    CHANGES_DETECTED="full"
    return
  fi

  # Store current commit for comparison
  OLD_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  log_info "Current commit: ${OLD_COMMIT:0:8}"

  # Set remote URL (in case token changed)
  git remote set-url origin "${REPO_URL}" 2>/dev/null || \
    git remote add origin "${REPO_URL}" 2>/dev/null || true

  # Stash any local changes (like backend/.env being tracked accidentally)
  git stash --include-untracked 2>/dev/null || true

  # Pull latest
  git fetch origin main 2>/dev/null || fail_exit "Failed to fetch from origin"
  git reset --hard origin/main 2>/dev/null || fail_exit "Failed to reset to origin/main"

  NEW_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  log_info "Latest commit:  ${NEW_COMMIT:0:8}"

  if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
    log_ok "Already up to date — no changes detected"
    CHANGES_DETECTED="none"
  else
    # Detect what changed
    CHANGED_FILES=$(git diff --name-only "${OLD_COMMIT}" "${NEW_COMMIT}" 2>/dev/null || echo "")
    CHANGES_DETECTED="none"

    FRONTEND_CHANGED=false
    BACKEND_CHANGED=false

    if echo "$CHANGED_FILES" | grep -qE "^(src/|Dockerfile|package|vite\.config|index\.html|tsconfig|postcss|tailwind)"; then
      FRONTEND_CHANGED=true
    fi

    if echo "$CHANGED_FILES" | grep -qE "^backend/"; then
      BACKEND_CHANGED=true
    fi

    if [ "$FRONTEND_CHANGED" = true ] && [ "$BACKEND_CHANGED" = true ]; then
      CHANGES_DETECTED="both"
    elif [ "$FRONTEND_CHANGED" = true ]; then
      CHANGES_DETECTED="frontend"
    elif [ "$BACKEND_CHANGED" = true ]; then
      CHANGES_DETECTED="backend"
    else
      CHANGES_DETECTED="config"
    fi

    log_ok "Changes pulled successfully"
    echo ""
    log_info "Changed files:"
    echo "$CHANGED_FILES" | head -20 | while read -r f; do
      echo -e "    ${CYAN}${f}${NC}"
    done
    TOTAL_CHANGED=$(echo "$CHANGED_FILES" | wc -l)
    if [ "$TOTAL_CHANGED" -gt 20 ]; then
      echo -e "    ${YELLOW}... and $((TOTAL_CHANGED - 20)) more${NC}"
    fi
    echo ""
    log_info "Affected services: ${BOLD}${CHANGES_DETECTED}${NC}"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Rebuild changed images
# ══════════════════════════════════════════════════════════════════════════════
step_rebuild() {
  separator
  log_info "Step 4/6 — Rebuilding Docker images"

  cd "${DEPLOY_DIR}"

  if [ "$CHANGES_DETECTED" = "none" ]; then
    log_ok "No changes — skipping rebuild"
    return
  fi

  # Login to GHCR
  echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_ORG}" --password-stdin 2>/dev/null
  log_ok "Logged in to GHCR"

  if [ "$CHANGES_DETECTED" = "backend" ] || [ "$CHANGES_DETECTED" = "both" ] || [ "$CHANGES_DETECTED" = "full" ]; then
    log_info "Building backend image..."
    docker build --no-cache -t ghcr.io/${GHCR_ORG}/cybersentinel-soar-backend:latest \
      -f backend/Dockerfile backend/ 2>&1 | tail -3
    log_ok "Backend image rebuilt"

    log_info "Pushing backend image to GHCR..."
    docker push ghcr.io/${GHCR_ORG}/cybersentinel-soar-backend:latest 2>&1 | tail -1
    log_ok "Backend image pushed"
  else
    log_info "Backend unchanged — skipping"
  fi

  if [ "$CHANGES_DETECTED" = "frontend" ] || [ "$CHANGES_DETECTED" = "both" ] || [ "$CHANGES_DETECTED" = "full" ]; then
    log_info "Building frontend image (this may take a few minutes)..."
    docker build --no-cache -t ghcr.io/${GHCR_ORG}/cybersentinel-soar-frontend:latest \
      -f Dockerfile . 2>&1 | tail -3
    log_ok "Frontend image rebuilt"

    log_info "Pushing frontend image to GHCR..."
    docker push ghcr.io/${GHCR_ORG}/cybersentinel-soar-frontend:latest 2>&1 | tail -1
    log_ok "Frontend image pushed"
  else
    log_info "Frontend unchanged — skipping"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Redeploy containers
# ══════════════════════════════════════════════════════════════════════════════
step_redeploy() {
  separator
  log_info "Step 5/6 — Redeploying services"

  cd "${DEPLOY_DIR}"

  if [ "$CHANGES_DETECTED" = "none" ]; then
    log_ok "No changes — skipping redeploy"
    return
  fi

  # Read current port config if containers are running
  FRONTEND_PORT=$(docker port soar-frontend 3000 2>/dev/null | cut -d: -f2 || echo "3000")
  BACKEND_PORT=$(docker port soar-backend 3001 2>/dev/null | cut -d: -f2 || echo "3001")
  [ -z "$FRONTEND_PORT" ] && FRONTEND_PORT=3000
  [ -z "$BACKEND_PORT" ] && BACKEND_PORT=3001

  export FRONTEND_PORT BACKEND_PORT

  # Stop and remove old containers to avoid ContainerConfig bug
  log_info "Stopping current containers..."
  ${COMPOSE_CMD} down --remove-orphans 2>/dev/null || true
  docker rm -f soar-frontend soar-backend soar-database 2>/dev/null || true

  # Start fresh
  log_info "Starting updated services (Frontend:${FRONTEND_PORT}, Backend:${BACKEND_PORT})..."
  FRONTEND_PORT="${FRONTEND_PORT}" BACKEND_PORT="${BACKEND_PORT}" ${COMPOSE_CMD} up -d

  if [ $? -eq 0 ]; then
    log_ok "All containers started"
  else
    fail_exit "Failed to start containers. Run: ${COMPOSE_CMD} logs"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Step 6: Health check & summary
# ══════════════════════════════════════════════════════════════════════════════
step_verify() {
  separator
  log_info "Step 6/6 — Health check"

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
  NEW_COMMIT=$(cd "${DEPLOY_DIR}" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")

  if [ "$ALL_HEALTHY" = true ]; then
    separator
    echo ""
    echo -e "${GREEN}${BOLD}  ╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}  ║          CyberSentinel SOAR — Update Complete                ║${NC}"
    echo -e "${GREEN}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}  Commit   → ${CYAN}${NEW_COMMIT}${NC}                                            ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}  Updated  → ${CYAN}${CHANGES_DETECTED}${NC}$(printf '%*s' $((40 - ${#CHANGES_DETECTED})) '')${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}  Status   → ${GREEN}All services healthy${NC}                            ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}                                                              ${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}  Frontend → ${CYAN}http://${SERVER_IP}:${FRONTEND_PORT}${NC}$(printf '%*s' $((24 - ${#SERVER_IP} - ${#FRONTEND_PORT})) '')${GREEN}${BOLD}║${NC}"
    echo -e "${GREEN}${BOLD}  ║${NC}  Backend  → ${CYAN}http://${SERVER_IP}:${BACKEND_PORT}${NC}$(printf '%*s' $((24 - ${#SERVER_IP} - ${#BACKEND_PORT})) '')${GREEN}${BOLD}║${NC}"
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

CHANGES_DETECTED="none"

step_authenticate
step_preflight
step_pull_code
step_rebuild
step_redeploy
step_verify

exit 0
