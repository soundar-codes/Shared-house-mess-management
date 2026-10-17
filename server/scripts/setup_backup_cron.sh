#!/usr/bin/env bash
# ==============================================================================
# Mess Management Project - Cron Schedule Setup Script
# Installs an automated daily backup job at 02:00 IST (Asia/Kolkata)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup.sh"
BACKUP_DIR="${BACKUP_DIR:-/home/soundar/backups/mess_db}"
LOG_FILE="${BACKUP_DIR}/backup.log"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
chmod +x "${BACKUP_SCRIPT}"

# Cron expression for 02:00 daily
CRON_JOB="0 2 * * * \"${BACKUP_SCRIPT}\" >> \"${LOG_FILE}\" 2>&1"

# Check if job already exists in crontab
CURRENT_CRON="$(crontab -l 2>/dev/null || true)"

if echo "${CURRENT_CRON}" | grep -F "${BACKUP_SCRIPT}" >/dev/null; then
    echo "[Cron Setup] Daily backup job is already scheduled in crontab:"
    echo "${CURRENT_CRON}" | grep -F "${BACKUP_SCRIPT}"
else
    # Append the cron job safely
    (echo "${CURRENT_CRON}"; echo "# Shared House Mess Management Daily Backup at 02:00 IST"; echo "${CRON_JOB}") | crontab -
    echo "[Cron Setup] Successfully scheduled daily backup at 02:00 IST in crontab."
    echo "[Cron Setup] Configured schedule:"
    crontab -l | grep -F "${BACKUP_SCRIPT}"
fi

echo "[Cron Setup] Backup script: ${BACKUP_SCRIPT}"
echo "[Cron Setup] Log file: ${LOG_FILE}"
echo "[Cron Setup] Status: CONFIGURED"
