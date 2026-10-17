const crypto = require('crypto');
const db = require('../utils/db');
const { getMonthBoundaries } = require('../utils/dateUtils');
const notificationService = require('./notificationService');

async function getActiveFoodConfig(householdId) {
    const res = await db.query(
        `SELECT fc.id, fc.default_rate_paise,
                COALESCE(h.cancellation_cutoff_time, '23:00') as cancellation_cutoff_time,
                COALESCE(h.timezone, 'Asia/Kolkata') as timezone
         FROM food_configuration fc
         LEFT JOIN households h ON h.id = fc.household_id
         WHERE fc.household_id = $1 
         AND fc.valid_from <= CURRENT_TIMESTAMP 
         AND (fc.valid_to IS NULL OR fc.valid_to > CURRENT_TIMESTAMP)
         ORDER BY fc.valid_from DESC LIMIT 1`,
        [householdId]
    );
    return res.rows[0];
}

/**
 * Returns active mess unavailability declarations for a household within a month.
 */
async function getActiveMessUnavailability(householdId, yearMonth, client = db) {
    const { startDate, endDate } = getMonthBoundaries(yearMonth);
    const res = await client.query(
        `SELECT id, household_id, TO_CHAR(declaration_date, 'YYYY-MM-DD') as declaration_date,
                reason, declared_by, status, created_at, updated_at
         FROM mess_unavailability_declarations
         WHERE household_id = $1 AND status = 'ACTIVE'
         AND declaration_date >= $2 AND declaration_date <= $3
         ORDER BY declaration_date ASC`,
        [householdId, startDate, endDate]
    );
    return res.rows.map(r => ({
        id: r.id,
        householdId: r.household_id,
        declarationDate: r.declaration_date,
        reason: r.reason,
        declaredBy: r.declared_by,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    }));
}

/**
 * Check if a specific date has an active mess unavailability declaration.
 */
async function isDateMessUnavailable(householdId, dateStr, client = db) {
    const res = await client.query(
        `SELECT id, reason, declared_by 
         FROM mess_unavailability_declarations
         WHERE household_id = $1 AND declaration_date = $2 AND status = 'ACTIVE'
         LIMIT 1`,
        [householdId, dateStr]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
}

/**
 * Declare food unavailable for the mess on a date (Admin only).
 * Past dates, today, and future dates are all allowed.
 */
async function declareMessUnavailable(householdId, dateStr, reason, actingUser) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const error = new Error('Valid date (YYYY-MM-DD) is required');
        error.status = 400;
        throw error;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        const error = new Error('A non-empty reason is required for mess unavailability');
        error.status = 400;
        throw error;
    }

    const trimmedReason = reason.trim();
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Check if there is already an active declaration for this household and date
        const activeCheck = await client.query(
            `SELECT id, reason FROM mess_unavailability_declarations
             WHERE household_id = $1 AND declaration_date = $2 AND status = 'ACTIVE'
             FOR UPDATE`,
            [householdId, dateStr]
        );

        if (activeCheck.rows.length > 0) {
            const conflictErr = new Error(`Mess is already declared unavailable for ${dateStr}: ${activeCheck.rows[0].reason}`);
            conflictErr.status = 409;
            throw conflictErr;
        }

        // Insert new ACTIVE declaration
        const insertRes = await client.query(
            `INSERT INTO mess_unavailability_declarations 
                (household_id, declaration_date, reason, declared_by, status)
             VALUES ($1, $2, $3, $4, 'ACTIVE')
             RETURNING id, household_id, TO_CHAR(declaration_date, 'YYYY-MM-DD') as declaration_date,
                       reason, declared_by, status, created_at`,
            [householdId, dateStr, trimmedReason, actingUser.id]
        );
        const declaration = insertRes.rows[0];

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'DECLARE_MESS_UNAVAILABLE',
                'mess_unavailability',
                String(declaration.id),
                trimmedReason,
                JSON.stringify({ householdId, date: dateStr, reason: trimmedReason })
            ]
        );

        // Notify all household members idempotently
        const membersRes = await client.query(
            `SELECT user_id FROM household_memberships WHERE household_id = $1`,
            [householdId]
        );

        for (const m of membersRes.rows) {
            const dedupKey = `mess_unavail_${householdId}_${dateStr}_${m.user_id}`;
            await notificationService.createNotification(
                m.user_id,
                'Mess Food Unavailable',
                `Mess food will not be provided on ${dateStr}. Reason: ${trimmedReason}`,
                dedupKey,
                client
            );
        }

        await client.query('COMMIT');
        return {
            id: declaration.id,
            householdId: declaration.household_id,
            declarationDate: declaration.declaration_date,
            reason: declaration.reason,
            declaredBy: declaration.declared_by,
            status: declaration.status,
            createdAt: declaration.created_at
        };
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') { // Unique constraint violation
            const conflictErr = new Error(`Mess is already declared unavailable for ${dateStr}`);
            conflictErr.status = 409;
            throw conflictErr;
        }
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Revoke an active mess unavailability declaration (Admin only).
 */
async function revokeMessUnavailable(householdId, dateStr, revocationReason, actingUser) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const error = new Error('Valid date (YYYY-MM-DD) is required');
        error.status = 400;
        throw error;
    }

    if (!revocationReason || typeof revocationReason !== 'string' || revocationReason.trim().length === 0) {
        const error = new Error('A non-empty revocationReason is required to revoke mess unavailability');
        error.status = 400;
        throw error;
    }

    const trimmedReason = revocationReason.trim();
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const activeRes = await client.query(
            `SELECT id, declaration_date, reason FROM mess_unavailability_declarations
             WHERE household_id = $1 AND declaration_date = $2 AND status = 'ACTIVE'
             FOR UPDATE`,
            [householdId, dateStr]
        );

        if (activeRes.rows.length === 0) {
            const notFoundErr = new Error(`No active mess unavailability declaration found for date ${dateStr}`);
            notFoundErr.status = 404;
            throw notFoundErr;
        }

        const currentDecl = activeRes.rows[0];

        const updateRes = await client.query(
            `UPDATE mess_unavailability_declarations
             SET status = 'REVOKED', revoked_by = $1, revocation_reason = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3
             RETURNING id, household_id, TO_CHAR(declaration_date, 'YYYY-MM-DD') as declaration_date,
                       reason, declared_by, status, revoked_by, revocation_reason, updated_at`,
            [actingUser.id, trimmedReason, currentDecl.id]
        );
        const revoked = updateRes.rows[0];

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'REVOKE_MESS_UNAVAILABLE',
                'mess_unavailability',
                String(currentDecl.id),
                trimmedReason,
                JSON.stringify({ householdId, date: dateStr, revocationReason: trimmedReason })
            ]
        );

        // Notify all household members
        const membersRes = await client.query(
            `SELECT user_id FROM household_memberships WHERE household_id = $1`,
            [householdId]
        );

        for (const m of membersRes.rows) {
            const dedupKey = `mess_revoked_${householdId}_${dateStr}_${m.user_id}_${Date.now()}`;
            await notificationService.createNotification(
                m.user_id,
                'Mess Food Resumed',
                `Mess food unavailability for ${dateStr} has been revoked. Reason: ${trimmedReason}`,
                dedupKey,
                client
            );
        }

        await client.query('COMMIT');
        return {
            id: revoked.id,
            householdId: revoked.household_id,
            declarationDate: revoked.declaration_date,
            reason: revoked.reason,
            status: revoked.status,
            revokedBy: revoked.revoked_by,
            revocationReason: revoked.revocation_reason,
            updatedAt: revoked.updated_at
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getMemberFoodRecords(householdId, userId, yearMonth) {
    const { startDate, endDate } = getMonthBoundaries(yearMonth);
    
    // Fetch member food records
    const res = await db.query(
        `SELECT id, user_id, TO_CHAR(record_date, 'YYYY-MM-DD') as date, status, rate_paise
         FROM food_records
         WHERE household_id = $1 AND user_id = $2
         AND record_date >= $3 AND record_date <= $4`,
        [householdId, userId, startDate, endDate]
    );

    // Fetch active mess unavailability declarations for the month
    const unavailList = await getActiveMessUnavailability(householdId, yearMonth);
    const unavailMap = new Map();
    unavailList.forEach(u => unavailMap.set(u.declarationDate, u));
    
    const records = res.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        date: row.date,
        status: unavailMap.has(row.date) ? 'MESS_UNAVAILABLE' : row.status,
        memberStatus: row.status,
        ratePaise: unavailMap.has(row.date) ? 0 : row.rate_paise,
        isMessUnavailable: unavailMap.has(row.date),
        messUnavailableReason: unavailMap.get(row.date)?.reason || null
    }));

    return { records, unavailList };
}

async function updateMemberFood(householdId, userId, dateStr, status, currentConfig) {
    // 1. Check if mess is unavailable for this date
    const unavail = await isDateMessUnavailable(householdId, dateStr);
    if (unavail) {
        const error = new Error(`Cannot update food status for ${dateStr}: Mess food is declared unavailable by administrator (${unavail.reason})`);
        error.status = 403;
        throw error;
    }

    // 2. Check if date is covered by approved leave for this member
    const leaveRes = await db.query(
        `SELECT id, reason FROM member_leaves
         WHERE household_id = $1 AND user_id = $2 AND status = 'ACTIVE'
           AND start_date <= $3 AND end_date >= $3
         LIMIT 1`,
        [householdId, userId, dateStr]
    );
    if (leaveRes.rows.length > 0) {
        const error = new Error(`Cannot update food status for ${dateStr}: You are already marked on approved leave (${leaveRes.rows[0].reason || 'Approved Leave'}). Food is already marked as not required.`);
        error.status = 403;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // 2. Upsert record ATOMICALLY
        const upsertRes = await client.query(
            `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (household_id, user_id, record_date) 
             DO UPDATE SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
             WHERE food_records.status != EXCLUDED.status
             RETURNING id, user_id, TO_CHAR(record_date, 'YYYY-MM-DD') as date, status, rate_paise`,
            [householdId, userId, dateStr, status, currentConfig.default_rate_paise]
        );
        
        let updatedRecord;
        let isGenuineTransition = false;

        if (upsertRes.rows.length > 0) {
            updatedRecord = upsertRes.rows[0];
            isGenuineTransition = true;
        } else {
            const existingRes = await client.query(
                `SELECT id, user_id, TO_CHAR(record_date, 'YYYY-MM-DD') as date, status, rate_paise 
                 FROM food_records 
                 WHERE household_id = $1 AND user_id = $2 AND record_date = $3`,
                [householdId, userId, dateStr]
            );
            updatedRecord = existingRes.rows[0];
        }

        // 3. Create notification for admin if a genuine transition to CANCELLED occurred
        if (isGenuineTransition && status === 'CANCELLED') {
            const adminRes = await client.query(
                `SELECT user_id FROM household_memberships WHERE household_id = $1 AND role = 'ADMIN' LIMIT 1`,
                [householdId]
            );
            if (adminRes.rows.length > 0) {
                const adminId = adminRes.rows[0].user_id;
                const dedupKey = `food_cancel_${householdId}_${userId}_${dateStr}_${crypto.randomUUID()}`;
                
                await client.query(
                    `INSERT INTO notifications (user_id, title, message, deduplication_key)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (user_id, deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
                    [
                        adminId,
                        'Food Cancelled',
                        `User ${userId} has cancelled food for ${dateStr}.`,
                        dedupKey
                    ]
                );
            }
        }

        await client.query('COMMIT');
        
        return {
            id: updatedRecord.id,
            userId: updatedRecord.user_id,
            date: updatedRecord.date,
            status: updatedRecord.status,
            ratePaise: updatedRecord.rate_paise
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Admin: Get attendance matrix for all household members across a date range [startDate, endDate] inclusive.
 */
async function getHouseholdAttendance(householdId, startDate, endDate) {
    if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        const error = new Error('Valid startDate and endDate (YYYY-MM-DD) are required');
        error.status = 400;
        throw error;
    }

    if (startDate > endDate) {
        const error = new Error('startDate cannot be after endDate');
        error.status = 400;
        throw error;
    }

    // 1. Fetch household members
    const membersRes = await db.query(
        `SELECT u.id, u.name, m.role, TO_CHAR(m.mess_start_date, 'YYYY-MM-DD') as mess_start_date
         FROM household_memberships m
         JOIN users u ON m.user_id = u.id
         WHERE m.household_id = $1
         ORDER BY u.name ASC`,
        [householdId]
    );
    const members = membersRes.rows;

    // 2. Fetch food records in range
    const recordsRes = await db.query(
        `SELECT id, user_id, TO_CHAR(record_date, 'YYYY-MM-DD') as date, status, rate_paise
         FROM food_records
         WHERE household_id = $1 AND record_date >= $2 AND record_date <= $3`,
        [householdId, startDate, endDate]
    );
    const recordMap = new Map();
    recordsRes.rows.forEach(r => recordMap.set(`${r.user_id}_${r.date}`, r));

    // 3. Fetch active leaves covering this range
    const leavesRes = await db.query(
        `SELECT id, user_id, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, 
                TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, reason, status
         FROM member_leaves
         WHERE household_id = $1 AND status = 'ACTIVE'
           AND start_date <= $3 AND end_date >= $2`,
        [householdId, startDate, endDate]
    );

    // 4. Fetch mess unavailability declarations
    const unavailRes = await db.query(
        `SELECT id, TO_CHAR(declaration_date, 'YYYY-MM-DD') as declaration_date, reason
         FROM mess_unavailability_declarations
         WHERE household_id = $1 AND status = 'ACTIVE'
           AND declaration_date >= $2 AND declaration_date <= $3`,
        [householdId, startDate, endDate]
    );
    const unavailMap = new Map();
    unavailRes.rows.forEach(u => unavailMap.set(u.declaration_date, u.reason));

    return {
        members,
        records: recordsRes.rows,
        leaves: leavesRes.rows,
        messUnavailability: unavailRes.rows
    };
}

/**
 * Admin: Update an individual member's attendance status for a given date.
 */
async function adminUpdateMemberAttendance(householdId, targetUserId, dateStr, status, actingUser, options = {}) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can update member attendance');
        error.status = 403;
        throw error;
    }

    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const error = new Error('Valid date (YYYY-MM-DD) is required');
        error.status = 400;
        throw error;
    }

    if (!['FOOD_REQUIRED', 'CANCELLED', 'ON_LEAVE'].includes(status)) {
        const error = new Error("Status must be 'FOOD_REQUIRED', 'CANCELLED', or 'ON_LEAVE'");
        error.status = 400;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Verify member belongs to household
        const memberRes = await client.query(
            `SELECT user_id FROM household_memberships WHERE household_id = $1 AND user_id = $2`,
            [householdId, targetUserId]
        );
        if (memberRes.rows.length === 0) {
            const error = new Error('Member not found in household');
            error.status = 404;
            throw error;
        }

        // Fetch current food configuration rate
        const confRes = await client.query(
            `SELECT default_rate_paise FROM food_configuration 
             WHERE household_id = $1 ORDER BY valid_from DESC LIMIT 1`,
            [householdId]
        );
        const ratePaise = confRes.rows.length > 0 ? confRes.rows[0].default_rate_paise : 13000;

        // Fetch previous status
        const prevRes = await client.query(
            `SELECT status FROM food_records 
             WHERE household_id = $1 AND user_id = $2 AND record_date = $3`,
            [householdId, targetUserId, dateStr]
        );
        const previousStatus = prevRes.rows.length > 0 ? prevRes.rows[0].status : 'FOOD_REQUIRED (default)';

        // Upsert record
        const upsertRes = await client.query(
            `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (household_id, user_id, record_date)
             DO UPDATE SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
             RETURNING id, user_id, TO_CHAR(record_date, 'YYYY-MM-DD') as date, status, rate_paise`,
            [householdId, targetUserId, dateStr, status, ratePaise]
        );
        const savedRecord = upsertRes.rows[0];

        // Check for discrepancy against finalized bill
        const finRes = await client.query(
            `SELECT id, billing_month, status FROM bills
             WHERE household_id = $1 AND user_id = $2 AND status = 'FINALIZED'
               AND period_start <= $3 AND period_end > $3`,
            [householdId, targetUserId, dateStr]
        );
        const hasFinalizedDiscrepancy = finRes.rows.length > 0;

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'ADMIN_UPDATE_ATTENDANCE',
                'food_record',
                `${householdId}_${targetUserId}_${dateStr}`,
                options.reason || `Attendance updated to ${status}`,
                JSON.stringify({
                    householdId,
                    userId: targetUserId,
                    date: dateStr,
                    previousStatus,
                    newStatus: status,
                    hasFinalizedDiscrepancy,
                    finalizedBillId: hasFinalizedDiscrepancy ? finRes.rows[0].id : null
                })
            ]
        );

        await client.query('COMMIT');
        return {
            ...savedRecord,
            hasFinalizedDiscrepancy,
            finalizedBillId: hasFinalizedDiscrepancy ? finRes.rows[0].id : null
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Admin: Bulk update attendance records for multiple members or a date range.
 */
async function adminBulkUpdateAttendance(householdId, updates, actingUser, reason = 'Bulk attendance update') {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can update attendance');
        error.status = 403;
        throw error;
    }

    if (!Array.isArray(updates) || updates.length === 0) {
        const error = new Error('updates array is required and must not be empty');
        error.status = 400;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch rate
        const confRes = await client.query(
            `SELECT default_rate_paise FROM food_configuration 
             WHERE household_id = $1 ORDER BY valid_from DESC LIMIT 1`,
            [householdId]
        );
        const ratePaise = confRes.rows.length > 0 ? confRes.rows[0].default_rate_paise : 13000;

        const results = [];
        const discrepancyBills = new Set();

        for (const item of updates) {
            const { userId, date, status } = item;
            if (!userId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                throw new Error(`Invalid update item: userId and YYYY-MM-DD date required`);
            }
            if (!['FOOD_REQUIRED', 'CANCELLED', 'ON_LEAVE'].includes(status)) {
                throw new Error(`Invalid status '${status}' for date ${date}`);
            }

            const upsertRes = await client.query(
                `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (household_id, user_id, record_date)
                 DO UPDATE SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
                 RETURNING id, user_id, TO_CHAR(record_date, 'YYYY-MM-DD') as date, status, rate_paise`,
                [householdId, userId, date, status, ratePaise]
            );
            results.push(upsertRes.rows[0]);

            // Check discrepancy with finalized bills
            const finRes = await client.query(
                `SELECT id FROM bills
                 WHERE household_id = $1 AND user_id = $2 AND status = 'FINALIZED'
                   AND period_start <= $3 AND period_end > $3`,
                [householdId, userId, date]
            );
            if (finRes.rows.length > 0) {
                discrepancyBills.add(finRes.rows[0].id);
            }
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'ADMIN_BULK_ATTENDANCE_UPDATE',
                'food_records',
                `${householdId}_bulk_${Date.now()}`,
                reason,
                JSON.stringify({
                    householdId,
                    count: updates.length,
                    discrepancyBillIds: Array.from(discrepancyBills)
                })
            ]
        );

        await client.query('COMMIT');
        return {
            updatedCount: results.length,
            records: results,
            discrepancyBillIds: Array.from(discrepancyBills)
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Admin: Create member leave period for one or all members.
 */
async function createMemberLeave(householdId, { userIds, startDate, endDate, reason }, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can create leave periods');
        error.status = 403;
        throw error;
    }

    if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        const error = new Error('Valid startDate and endDate (YYYY-MM-DD) are required');
        error.status = 400;
        throw error;
    }

    if (startDate > endDate) {
        const error = new Error('startDate cannot be after endDate');
        error.status = 400;
        throw error;
    }

    const { getDatesInInterval } = require('../utils/dateUtils');
    // Calculate inclusive dates [startDate, endDate]
    const nextDay = new Date(`${endDate}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const dayAfterEndDate = nextDay.toISOString().split('T')[0];
    const leaveDates = getDatesInInterval(startDate, dayAfterEndDate);

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Resolve target members
        let targetMembers = [];
        if (!userIds || userIds === 'ALL' || (Array.isArray(userIds) && userIds.length === 0)) {
            const allRes = await client.query(
                `SELECT user_id FROM household_memberships WHERE household_id = $1`,
                [householdId]
            );
            targetMembers = allRes.rows.map(r => r.user_id);
        } else if (Array.isArray(userIds)) {
            targetMembers = userIds;
        } else {
            targetMembers = [userIds];
        }

        const confRes = await client.query(
            `SELECT default_rate_paise FROM food_configuration 
             WHERE household_id = $1 ORDER BY valid_from DESC LIMIT 1`,
            [householdId]
        );
        const ratePaise = confRes.rows.length > 0 ? confRes.rows[0].default_rate_paise : 13000;

        const createdLeaves = [];

        for (const uId of targetMembers) {
            // Check for overlapping ACTIVE leave for this member
            const overlapCheck = await client.query(
                `SELECT id, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, TO_CHAR(end_date, 'YYYY-MM-DD') as end_date 
                 FROM member_leaves
                 WHERE household_id = $1 AND user_id = $2 AND status = 'ACTIVE'
                   AND start_date <= $4 AND end_date >= $3`,
                [householdId, uId, startDate, endDate]
            );
            if (overlapCheck.rows.length > 0) {
                const error = new Error(`Member ${uId} already has an active overlapping leave period (${overlapCheck.rows[0].start_date} to ${overlapCheck.rows[0].end_date})`);
                error.status = 400;
                throw error;
            }

            // Inspect existing food_records in this date range to preserve previous status
            const existingRecordsRes = await client.query(
                `SELECT TO_CHAR(record_date, 'YYYY-MM-DD') as record_date, status, rate_paise
                 FROM food_records
                 WHERE household_id = $1 AND user_id = $2
                   AND record_date >= $3 AND record_date <= $4`,
                [householdId, uId, startDate, endDate]
            );
            const overwrittenRecords = existingRecordsRes.rows.map(r => ({
                date: r.record_date,
                previousStatus: r.status,
                ratePaise: r.rate_paise
            }));

            // 1. Insert leave record with overwritten_records
            const leaveRes = await client.query(
                `INSERT INTO member_leaves (household_id, user_id, start_date, end_date, reason, created_by, status, overwritten_records)
                 VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7)
                 RETURNING id, household_id, user_id, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date,
                           TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, reason, status, overwritten_records`,
                [householdId, uId, startDate, endDate, reason || 'Scheduled Leave', actingUser.id, JSON.stringify(overwrittenRecords)]
            );
            createdLeaves.push(leaveRes.rows[0]);

            // 2. Mark food_records as ON_LEAVE for all days in the range
            for (const dayStr of leaveDates) {
                await client.query(
                    `INSERT INTO food_records (household_id, user_id, record_date, status, rate_paise)
                     VALUES ($1, $2, $3, 'ON_LEAVE', $4)
                     ON CONFLICT (household_id, user_id, record_date)
                     DO UPDATE SET status = 'ON_LEAVE', updated_at = CURRENT_TIMESTAMP`,
                    [householdId, uId, dayStr, ratePaise]
                );
            }
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'CREATE_MEMBER_LEAVE',
                'member_leaves',
                `${householdId}_${startDate}_${endDate}`,
                reason || `Leave created for ${targetMembers.length} members`,
                JSON.stringify({
                    householdId,
                    startDate,
                    endDate,
                    membersCount: targetMembers.length,
                    members: targetMembers,
                    daysCount: leaveDates.length
                })
            ]
        );

        await client.query('COMMIT');
        return {
            leaves: createdLeaves,
            affectedMembersCount: targetMembers.length,
            affectedDates: leaveDates
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Admin: Get active and past leaves for the household.
 */
async function getHouseholdLeaves(householdId) {
    const res = await db.query(
        `SELECT l.id, l.household_id, l.user_id, u.name as user_name,
                TO_CHAR(l.start_date, 'YYYY-MM-DD') as start_date,
                TO_CHAR(l.end_date, 'YYYY-MM-DD') as end_date,
                l.reason, l.status, l.created_by, l.created_at, l.overwritten_records
         FROM member_leaves l
         JOIN users u ON l.user_id = u.id
         WHERE l.household_id = $1
         ORDER BY l.start_date DESC`,
        [householdId]
    );
    return res.rows;
}

/**
 * Admin: Cancel an existing leave period and revert food_records safely.
 * Never overwrites an earlier CANCELLED record with FOOD_REQUIRED.
 */
async function cancelMemberLeave(householdId, leaveId, cancellationReason, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can cancel leave periods');
        error.status = 403;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const leaveRes = await client.query(
            `SELECT id, user_id, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, 
                    TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, status, overwritten_records
             FROM member_leaves
             WHERE household_id = $1 AND id = $2 AND status = 'ACTIVE'
             FOR UPDATE`,
            [householdId, leaveId]
        );

        if (leaveRes.rows.length === 0) {
            const error = new Error('Active leave record not found');
            error.status = 404;
            throw error;
        }

        const leave = leaveRes.rows[0];
        const overwrittenMap = new Map();
        if (leave.overwritten_records && Array.isArray(leave.overwritten_records)) {
            leave.overwritten_records.forEach(rec => {
                overwrittenMap.set(rec.date, rec.previousStatus);
            });
        }

        // 1. Mark leave CANCELLED
        await client.query(
            `UPDATE member_leaves
             SET status = 'CANCELLED', cancelled_by = $1, cancellation_reason = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [actingUser.id, cancellationReason || 'Cancelled by administrator', leaveId]
        );

        // 2. Revert food_records in range safely
        const { getDatesInInterval } = require('../utils/dateUtils');
        const nextDay = new Date(`${leave.end_date}T00:00:00.000Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const dayAfterEndDate = nextDay.toISOString().split('T')[0];
        const leaveDates = getDatesInInterval(leave.start_date, dayAfterEndDate);

        for (const dayStr of leaveDates) {
            const prevStatus = overwrittenMap.get(dayStr);
            if (prevStatus === 'CANCELLED') {
                // Restore CANCELLED, do NOT overwrite with FOOD_REQUIRED
                await client.query(
                    `UPDATE food_records
                     SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
                     WHERE household_id = $1 AND user_id = $2 AND record_date = $3 AND status = 'ON_LEAVE'`,
                    [householdId, leave.user_id, dayStr]
                );
            } else {
                // Otherwise restore FOOD_REQUIRED
                await client.query(
                    `UPDATE food_records
                     SET status = 'FOOD_REQUIRED', updated_at = CURRENT_TIMESTAMP
                     WHERE household_id = $1 AND user_id = $2 AND record_date = $3 AND status = 'ON_LEAVE'`,
                    [householdId, leave.user_id, dayStr]
                );
            }
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'CANCEL_MEMBER_LEAVE',
                'member_leaves',
                String(leaveId),
                cancellationReason || 'Leave cancelled',
                JSON.stringify({ leaveId, userId: leave.user_id, startDate: leave.start_date, endDate: leave.end_date })
            ]
        );

        await client.query('COMMIT');
        return { message: 'Leave cancelled successfully', leaveId };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    getActiveFoodConfig,
    getActiveMessUnavailability,
    isDateMessUnavailable,
    declareMessUnavailable,
    revokeMessUnavailable,
    getMemberFoodRecords,
    updateMemberFood,
    getHouseholdAttendance,
    adminUpdateMemberAttendance,
    adminBulkUpdateAttendance,
    createMemberLeave,
    getHouseholdLeaves,
    cancelMemberLeave
};

