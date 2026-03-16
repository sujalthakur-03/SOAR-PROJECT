#!/usr/bin/env bash
# CyberSentinel SOAR - MongoDB Backup Script
# Usage: ./cybersentinel-backup-soar.sh [backup-dir]
# Cron:  0 2 * * * /opt/cybersentinel-soar/cybersentinel-backup-soar.sh

set -euo pipefail

BACKUP_BASE="${1:-/opt/cybersentinel-soar/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_BASE}/${TIMESTAMP}"
CONTAINER_NAME="soar-database"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[BACKUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# Check container is running
docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$" || fail "Container ${CONTAINER_NAME} is not running"

# Create backup directory
mkdir -p "${BACKUP_DIR}"
info "Backup directory: ${BACKUP_DIR}"

# Run mongodump inside container, copy out
info "Running mongodump..."
docker exec "${CONTAINER_NAME}" mongodump --db soar --out /tmp/backup_${TIMESTAMP} --quiet || fail "mongodump failed"

# Copy from container to host
docker cp "${CONTAINER_NAME}:/tmp/backup_${TIMESTAMP}" "${BACKUP_DIR}/dump" || fail "Failed to copy backup from container"

# Cleanup inside container
docker exec "${CONTAINER_NAME}" rm -rf "/tmp/backup_${TIMESTAMP}"

# Compress
info "Compressing backup..."
tar -czf "${BACKUP_DIR}.tar.gz" -C "${BACKUP_BASE}" "${TIMESTAMP}" || fail "Compression failed"
rm -rf "${BACKUP_DIR}"

# Record metadata
BACKUP_SIZE=$(du -sh "${BACKUP_DIR}.tar.gz" | cut -f1)
info "Backup complete: ${BACKUP_DIR}.tar.gz (${BACKUP_SIZE})"

# Prune old backups
info "Pruning backups older than ${RETENTION_DAYS} days..."
PRUNED=$(find "${BACKUP_BASE}" -name "*.tar.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [ "${PRUNED}" -gt 0 ]; then
  info "Pruned ${PRUNED} old backup(s)"
fi

# List remaining backups
REMAINING=$(find "${BACKUP_BASE}" -name "*.tar.gz" | wc -l)
info "Total backups: ${REMAINING}"

info "Done!"
