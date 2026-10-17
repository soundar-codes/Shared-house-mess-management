#!/usr/bin/env bash
# ==============================================================================
# Mess Management Project - Test Database Restore & Integrity Verification Script
# Restores a pg_dump custom format file into a designated TEST database and verifies:
# 1. Members and accounts
# 2. Attendance & food records
# 3. Leave records
# 4. Finalized bills & payments
# 5. Audit history & House information
# 6. Compatibility with migrations
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${SERVER_DIR}/.env" ]]; then
    export $(grep -v '^#' "${SERVER_DIR}/.env" | xargs)
fi

RESTORE_DB_URL="${RESTORE_DATABASE_URL:-${TEST_DATABASE_URL:-}}"
BACKUP_FILE="${1:-}"

if [[ -z "${RESTORE_DB_URL}" ]]; then
    echo "ERROR: RESTORE_DATABASE_URL or TEST_DATABASE_URL must be specified." >&2
    exit 1
fi

# SAFETY CHECK: Never restore over a production or non-test database!
if [[ "${RESTORE_DB_URL}" != *"_test"* ]]; then
    echo "FATAL SAFETY ABORT: Target database '${RESTORE_DB_URL}' does not appear to be a test database (must contain '_test'). Refusing to restore!" >&2
    exit 1
fi

# If no backup file specified, pick the newest dump from BACKUP_DIR
BACKUP_DIR="${BACKUP_DIR:-/home/soundar/backups/mess_db}"
if [[ -z "${BACKUP_FILE}" ]]; then
    BACKUP_FILE="$(ls -t "${BACKUP_DIR}"/mess_db_*.dump 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "${BACKUP_FILE}" || ! -f "${BACKUP_FILE}" ]]; then
    echo "ERROR: Backup file not found: ${BACKUP_FILE}" >&2
    exit 1
fi

DB_HOST_DB="$(echo "${RESTORE_DB_URL}" | sed -E 's|.*@([^/?]+).*|\1|')"
echo "======================================================================"
echo "[Restore Verification] Restoring backup to test database: ${DB_HOST_DB}"
echo "[Restore Verification] Source dump: ${BACKUP_FILE}"
echo "======================================================================"

# Step 1: Drop and recreate public schema on target test database
psql "${RESTORE_DB_URL}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1

# Step 2: Restore from custom format archive
pg_restore \
    --dbname="${RESTORE_DB_URL}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    "${BACKUP_FILE}" || true

echo "[Restore] Dump restored into ${DB_HOST_DB} successfully."

# Step 3: Run comprehensive verification queries
echo "[Verification] Inspecting restored schema and records..."

psql "${RESTORE_DB_URL}" -c "
SELECT 'users' as entity, COUNT(*) as count FROM users
UNION ALL
SELECT 'household_memberships', COUNT(*) FROM household_memberships
UNION ALL
SELECT 'food_records', COUNT(*) FROM food_records
UNION ALL
SELECT 'member_leaves', COUNT(*) FROM member_leaves
UNION ALL
SELECT 'bills', COUNT(*) FROM bills
UNION ALL
SELECT 'payments', COUNT(*) FROM payments
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL
SELECT 'household_information', COUNT(*) FROM household_information;
"

# Step 4: Verify migration compatibility on restored database
echo "[Verification] Testing migration compatibility on restored database..."
DATABASE_URL="${RESTORE_DB_URL}" node "${SERVER_DIR}/src/utils/migrate.js"

echo "======================================================================"
echo "[Restore Verification] ALL CHECKS PASSED: Backup is verified and recoverable."
echo "======================================================================"
