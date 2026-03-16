#!/usr/bin/env bash
# CyberSentinel SOAR - MongoDB Restore Script
# Usage: ./cybersentinel-restore-soar.sh <backup-file.tar.gz>

set -euo pipefail

BACKUP_FILE="${1:-}"
CONTAINER_NAME="soar-database"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[RESTORE]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

[ -z "${BACKUP_FILE}" ] && fail "Usage: $0 <backup-file.tar.gz>"
[ -f "${BACKUP_FILE}" ] || fail "Backup file not found: ${BACKUP_FILE}"
docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$" || fail "Container ${CONTAINER_NAME} is not running"

warn "This will OVERWRITE the current database. Are you sure? (yes/no)"
read -r CONFIRM
[ "${CONFIRM}" = "yes" ] || { info "Restore cancelled."; exit 0; }

# Extract backup
TEMP_DIR=$(mktemp -d)
info "Extracting ${BACKUP_FILE}..."
tar -xzf "${BACKUP_FILE}" -C "${TEMP_DIR}"

# Find the dump directory
DUMP_DIR=$(find "${TEMP_DIR}" -name "dump" -type d | head -1)
[ -d "${DUMP_DIR}" ] || fail "No dump directory found in backup"

# Copy into container
TIMESTAMP=$(date +%s)
docker cp "${DUMP_DIR}" "${CONTAINER_NAME}:/tmp/restore_${TIMESTAMP}"

# Run mongorestore
info "Running mongorestore..."
docker exec "${CONTAINER_NAME}" mongorestore --db cybersentinel --drop "/tmp/restore_${TIMESTAMP}/cybersentinel" --quiet || fail "mongorestore failed"

# Cleanup
docker exec "${CONTAINER_NAME}" rm -rf "/tmp/restore_${TIMESTAMP}"
rm -rf "${TEMP_DIR}"

info "Database restored successfully from ${BACKUP_FILE}"
