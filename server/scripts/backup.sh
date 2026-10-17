#!/usr/bin/env bash
# ==============================================================================
# Mess Management Project - Automated Database Backup Script
# Uses native pg_dump in custom format (-Fc) with strict permissions,
# overlap prevention (flock), and retention protection (never deletes last copies)
# ==============================================================================
set -euo pipefail

# Overlap prevention via non-blocking file lock
LOCK_FILE="/tmp/mess_db_backup.lock"
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [Backup ERROR] Another backup job is currently running. Exiting to avoid overlap." >&2
    exit 1
fi

# Determine script directory and server directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load environment variables if .env exists
if [[ -f "${SERVER_DIR}/.env" ]]; then
    export $(grep -v '^#' "${SERVER_DIR}/.env" | xargs)
fi

# Configuration with safe defaults
DB_URL="${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}"
BACKUP_DIR="${BACKUP_DIR:-/home/soundar/backups/mess_db}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
MIN_KEEP="${BACKUP_MIN_KEEP:-2}"

if [[ -z "${DB_URL}" ]]; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [Backup ERROR] Neither BACKUP_DATABASE_URL nor DATABASE_URL is set." >&2
    exit 1
fi

# Ensure backup directory exists with restrictive permissions (0700)
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

# Generate timestamped backup file name
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILENAME="mess_db_${TIMESTAMP}.dump"
BACKUP_FILEPATH="${BACKUP_DIR}/${BACKUP_FILENAME}"

# Sanitized DB identifier for log output (hides credentials)
DB_HOST_DB="$(echo "${DB_URL}" | sed -E 's|.*@([^/?]+).*|\1|')"
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting PostgreSQL backup..."
echo "[Backup] Target host/db: ${DB_HOST_DB}"
echo "[Backup] Destination: ${BACKUP_FILEPATH}"

# Execute pg_dump using custom compressed format
if ! pg_dump \
    --dbname="${DB_URL}" \
    --format=custom \
    --compress=6 \
    --no-owner \
    --no-privileges \
    --file="${BACKUP_FILEPATH}"; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [Backup ERROR] pg_dump failed! Removing partial dump." >&2
    rm -f "${BACKUP_FILEPATH}"
    exit 2
fi

# Restrict backup file permissions to 0600 (owner read/write only)
chmod 600 "${BACKUP_FILEPATH}"

BACKUP_SIZE="$(du -h "${BACKUP_FILEPATH}" | cut -f1)"
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup completed successfully. Size: ${BACKUP_SIZE}"

# Enforce retention policy safely: NEVER delete the only available copies
TOTAL_DUMPS="$(ls -1t "${BACKUP_DIR}"/mess_db_*.dump 2>/dev/null | wc -l || echo 0)"
echo "[Backup] Retention check: ${TOTAL_DUMPS} total dumps found in ${BACKUP_DIR} (minimum threshold: ${MIN_KEEP})."

if (( TOTAL_DUMPS > MIN_KEEP )); then
    echo "[Backup] Applying retention policy: searching for dumps older than ${RETENTION_DAYS} days..."
    # Iterate through candidates and preserve at least MIN_KEEP dumps
    find "${BACKUP_DIR}" -type f -name "mess_db_*.dump" -mtime +"${RETENTION_DAYS}" | while read -r old_dump; do
        CURRENT_COUNT="$(ls -1t "${BACKUP_DIR}"/mess_db_*.dump 2>/dev/null | wc -l)"
        if (( CURRENT_COUNT > MIN_KEEP )); then
            echo "[Backup] Pruning expired dump: $(basename "${old_dump}")"
            rm -f "${old_dump}"
        fi
    done
else
    echo "[Backup] Total backups (${TOTAL_DUMPS}) is within safe minimum retention limit (${MIN_KEEP}). No pruning needed."
fi

echo "[Backup] Current available backups:"
ls -lh "${BACKUP_DIR}" | grep "mess_db_" || true

echo "[Backup] Status: SUCCESS"
