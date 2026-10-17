const db = require('../utils/db');
const { getKolkataDateParts } = require('../utils/dateUtils');

/**
 * Fetch the 9-entry vessel washing rotation for a household.
 * Sunday (assigned_user_id IS NULL) is mapped to group duty.
 */
async function getVesselSchedule(householdId) {
    const res = await db.query(
        `SELECT 
            vs.id, 
            vs.day_of_week, 
            vs.time_period, 
            vs.assigned_user_id, 
            u.name as assigned_user_name
         FROM vessel_schedules vs
         LEFT JOIN users u ON vs.assigned_user_id = u.id
         WHERE vs.household_id = $1
         ORDER BY 
            CASE vs.day_of_week
                WHEN 'Monday' THEN 1
                WHEN 'Tuesday' THEN 2
                WHEN 'Wednesday' THEN 3
                WHEN 'Thursday' THEN 4
                WHEN 'Friday' THEN 5
                WHEN 'Saturday' THEN 6
                WHEN 'Sunday' THEN 7
            END,
            CASE vs.time_period
                WHEN 'ALL_DAY' THEN 1
                WHEN 'MORNING' THEN 2
                WHEN 'EVENING' THEN 3
            END`,
        [householdId]
    );

    return res.rows.map(row => ({
        id: row.id,
        dayOfWeek: row.day_of_week,
        timePeriod: row.time_period,
        assignedUserId: row.assigned_user_id,
        assignedUserName: row.assigned_user_id ? row.assigned_user_name : 'All Members (Group Duty)',
        isGroupDuty: row.assigned_user_id === null
    }));
}

/**
 * Updates a vessel cleaning schedule entry (Admin only).
 * Validates day_of_week, time_period, and assigned user.
 * Supports Sunday group duty (assignedUserId = null) or specific member assignment.
 */
async function updateVesselSchedule(householdId, scheduleId, { assignedUserId }, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can update the vessel cleaning schedule');
        error.status = 403;
        throw error;
    }

    // Verify schedule entry exists and belongs to household
    const existingRes = await db.query(
        `SELECT id, household_id, day_of_week, time_period, assigned_user_id
         FROM vessel_schedules
         WHERE id = $1 AND household_id = $2`,
        [scheduleId, householdId]
    );

    if (existingRes.rows.length === 0) {
        const error = new Error('Vessel schedule entry not found');
        error.status = 404;
        throw error;
    }

    const currentEntry = existingRes.rows[0];

    // If assignedUserId is provided and non-null, verify member belongs to this household
    let assignedUserName = null;
    if (assignedUserId !== null && assignedUserId !== undefined) {
        const memberCheck = await db.query(
            `SELECT u.id, u.name 
             FROM household_memberships hm
             JOIN users u ON hm.user_id = u.id
             WHERE hm.household_id = $1 AND hm.user_id = $2`,
            [householdId, assignedUserId]
        );

        if (memberCheck.rows.length === 0) {
            const error = new Error('Assigned user must be an active member of this household');
            error.status = 400;
            throw error;
        }
        assignedUserName = memberCheck.rows[0].name;
    }

    const targetUserId = assignedUserId || null;

    const updateRes = await db.query(
        `UPDATE vessel_schedules
         SET assigned_user_id = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND household_id = $3
         RETURNING id, day_of_week, time_period, assigned_user_id, updated_at`,
        [targetUserId, scheduleId, householdId]
    );

    const updatedRow = updateRes.rows[0];

    // Log the change in audit_logs
    await db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
            actingUser.id,
            'UPDATE_VESSEL_SCHEDULE',
            'vessel_schedule',
            String(scheduleId),
            `Updated vessel duty for ${currentEntry.day_of_week} (${currentEntry.time_period})`,
            JSON.stringify({
                scheduleId,
                dayOfWeek: currentEntry.day_of_week,
                timePeriod: currentEntry.time_period,
                previousAssignedUserId: currentEntry.assigned_user_id,
                newAssignedUserId: targetUserId
            })
        ]
    );

    return {
        id: updatedRow.id,
        dayOfWeek: updatedRow.day_of_week,
        timePeriod: updatedRow.time_period,
        assignedUserId: updatedRow.assigned_user_id,
        assignedUserName: updatedRow.assigned_user_id ? assignedUserName : 'All Members (Group Duty)',
        isGroupDuty: updatedRow.assigned_user_id === null
    };
}

/**
 * Get all chore assignments for a household, optionally filtered by user or date.
 */
async function getAssignments(householdId, { userId = null, status = null } = {}) {
    let queryText = `
        SELECT 
            ca.id,
            ca.chore_id,
            cd.name as chore_name,
            cd.description as chore_description,
            ca.user_id,
            u.name as user_name,
            TO_CHAR(ca.assigned_date, 'YYYY-MM-DD') as assigned_date,
            TO_CHAR(ca.due_date, 'YYYY-MM-DD') as due_date,
            ca.status,
            ca.created_at,
            ca.updated_at
        FROM chore_assignments ca
        JOIN chore_definitions cd ON ca.chore_id = cd.id
        LEFT JOIN users u ON ca.user_id = u.id
        WHERE cd.household_id = $1
    `;
    const params = [householdId];

    if (userId) {
        params.push(userId);
        queryText += ` AND ca.user_id = $${params.length}`;
    }

    if (status) {
        params.push(status);
        queryText += ` AND ca.status = $${params.length}`;
    }

    queryText += ` ORDER BY ca.due_date ASC NULLS LAST, ca.id ASC`;

    const res = await db.query(queryText, params);
    return res.rows.map(r => ({
        id: r.id,
        choreId: r.chore_id,
        choreName: r.chore_name,
        choreDescription: r.chore_description,
        userId: r.user_id,
        userName: r.user_name || 'Unassigned',
        assignedDate: r.assigned_date,
        dueDate: r.due_date,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    }));
}

/**
 * Update the status of a chore assignment.
 * Enforces role check (members can only update their own assignment; admins can update any).
 * Logs status transition in audit_logs.
 */
async function updateAssignmentStatus(householdId, assignmentId, newStatus, actingUser) {
    const validStatuses = ['PENDING', 'COMPLETED', 'MISSED', 'EXCUSED'];
    if (!validStatuses.includes(newStatus)) {
        const error = new Error(`Invalid status: ${newStatus}. Must be one of ${validStatuses.join(', ')}`);
        error.status = 400;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch assignment and verify household ownership
        const assignRes = await client.query(
            `SELECT ca.id, ca.user_id, ca.status, cd.household_id, cd.name as chore_name
             FROM chore_assignments ca
             JOIN chore_definitions cd ON ca.chore_id = cd.id
             WHERE ca.id = $1`,
            [assignmentId]
        );

        if (assignRes.rows.length === 0) {
            const error = new Error('Chore assignment not found');
            error.status = 404;
            throw error;
        }

        const assignment = assignRes.rows[0];

        if (assignment.household_id !== householdId) {
            const error = new Error('Forbidden: Assignment belongs to a different household');
            error.status = 403;
            throw error;
        }

        // Authorization check: Members can only update their own assignment
        if (actingUser.role !== 'ADMIN' && assignment.user_id !== actingUser.id) {
            const error = new Error('Forbidden: Members can only update their own assignments');
            error.status = 403;
            throw error;
        }

        const oldStatus = assignment.status;

        // Perform atomic update
        const updateRes = await client.query(
            `UPDATE chore_assignments
             SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING id, chore_id, user_id, TO_CHAR(assigned_date, 'YYYY-MM-DD') as assigned_date, 
                       TO_CHAR(due_date, 'YYYY-MM-DD') as due_date, status, updated_at`,
            [newStatus, assignmentId]
        );

        const updated = updateRes.rows[0];

        // Record in audit_logs if status changed
        if (oldStatus !== newStatus) {
            await client.query(
                `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    actingUser.id,
                    'UPDATE_CHORE_STATUS',
                    'chore_assignment',
                    String(assignmentId),
                    `Status changed from ${oldStatus} to ${newStatus}`,
                    JSON.stringify({
                        choreName: assignment.chore_name,
                        fromStatus: oldStatus,
                        toStatus: newStatus,
                        assignedUserId: assignment.user_id
                    })
                ]
            );
        }

        await client.query('COMMIT');

        return {
            id: updated.id,
            choreId: updated.chore_id,
            userId: updated.user_id,
            assignedDate: updated.assigned_date,
            dueDate: updated.due_date,
            status: updated.status,
            updatedAt: updated.updated_at
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Get current open dustbin cycle for household.
 */
async function getCurrentDustbinCycle(householdId) {
    const res = await db.query(
        `SELECT 
            dc.id,
            dc.household_id,
            dc.claimant_user_id,
            u.name as claimant_name,
            TO_CHAR(dc.cycle_start_date, 'YYYY-MM-DD') as cycle_start_date,
            dc.status,
            dc.created_at,
            dc.updated_at
         FROM dustbin_cycles dc
         LEFT JOIN users u ON dc.claimant_user_id = u.id
         WHERE dc.household_id = $1 AND dc.status = 'OPEN'
         LIMIT 1`,
        [householdId]
    );

    if (res.rows.length === 0) {
        return null;
    }

    const row = res.rows[0];
    return {
        id: row.id,
        householdId: row.household_id,
        claimantUserId: row.claimant_user_id,
        claimantName: row.claimant_name || 'Unassigned',
        cycleStartDate: row.cycle_start_date,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Claim or take over dustbin cycle.
 * Rules:
 * - If no cycle is OPEN, create one for the claimant with today's date (Asia/Kolkata).
 * - If a cycle is OPEN and already claimed by claimant, return it idempotently.
 * - If a cycle is OPEN and claimed by another member:
 *     - Only permitted if 'allowTakeover' is true, OR claimant is ADMIN.
 *     - If takeover occurs, updates claimant and logs to audit_logs.
 * - Handles concurrent creations safely via transaction and UNIQUE INDEX idx_dustbin_open_cycle.
 */
async function claimDustbinCycle(householdId, claimantUserId, { allowTakeover = false, actingUser } = {}) {
    const kolkataToday = getKolkataDateParts().dateStr;
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // Check if there is an existing OPEN cycle (locking only dustbin_cycles row FOR UPDATE)
        const existingRes = await client.query(
            `SELECT dc.id, dc.claimant_user_id, dc.cycle_start_date, dc.status, u.name as claimant_name
             FROM dustbin_cycles dc
             LEFT JOIN users u ON dc.claimant_user_id = u.id
             WHERE dc.household_id = $1 AND dc.status = 'OPEN'
             FOR UPDATE OF dc`,
            [householdId]
        );

        if (existingRes.rows.length > 0) {
            const currentCycle = existingRes.rows[0];

            // If already claimed by this user
            if (currentCycle.claimant_user_id === claimantUserId) {
                await client.query('COMMIT');
                return {
                    id: currentCycle.id,
                    householdId,
                    claimantUserId: currentCycle.claimant_user_id,
                    claimantName: currentCycle.claimant_name,
                    cycleStartDate: currentCycle.cycle_start_date,
                    status: currentCycle.status,
                    message: 'Cycle is already claimed by you'
                };
            }

            // Claimed by someone else
            const canTakeover = allowTakeover || (actingUser && actingUser.role === 'ADMIN');
            if (!canTakeover) {
                const error = new Error(`Dustbin duty is currently claimed by ${currentCycle.claimant_name || currentCycle.claimant_user_id}. Takeover confirmation required.`);
                error.status = 409;
                error.currentClaimant = {
                    userId: currentCycle.claimant_user_id,
                    name: currentCycle.claimant_name
                };
                throw error;
            }

            // Perform takeover
            const oldClaimant = currentCycle.claimant_user_id;
            const updateRes = await client.query(
                `UPDATE dustbin_cycles
                 SET claimant_user_id = $1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2
                 RETURNING id, household_id, claimant_user_id, TO_CHAR(cycle_start_date, 'YYYY-MM-DD') as cycle_start_date, status, updated_at`,
                [claimantUserId, currentCycle.id]
            );

            // Fetch user name
            const userNameRes = await client.query('SELECT name FROM users WHERE id = $1', [claimantUserId]);
            const newClaimantName = userNameRes.rows[0]?.name || claimantUserId;

            // Audit log the takeover
            await client.query(
                `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    actingUser ? actingUser.id : claimantUserId,
                    'TAKEOVER_DUSTBIN_CYCLE',
                    'dustbin_cycle',
                    String(currentCycle.id),
                    `Dustbin duty taken over from ${oldClaimant} by ${claimantUserId}`,
                    JSON.stringify({
                        previousClaimant: oldClaimant,
                        newClaimant: claimantUserId,
                        cycleId: currentCycle.id
                    })
                ]
            );

            await client.query('COMMIT');
            return {
                id: updateRes.rows[0].id,
                householdId,
                claimantUserId,
                claimantName: newClaimantName,
                cycleStartDate: updateRes.rows[0].cycle_start_date,
                status: updateRes.rows[0].status,
                updatedAt: updateRes.rows[0].updated_at
            };
        }

        // No open cycle exists -> Insert new cycle
        const insertRes = await client.query(
            `INSERT INTO dustbin_cycles (household_id, claimant_user_id, cycle_start_date, status)
             VALUES ($1, $2, $3, 'OPEN')
             RETURNING id, household_id, claimant_user_id, TO_CHAR(cycle_start_date, 'YYYY-MM-DD') as cycle_start_date, status, created_at`,
            [householdId, claimantUserId, kolkataToday]
        );

        const newCycle = insertRes.rows[0];
        const userNameRes = await client.query('SELECT name FROM users WHERE id = $1', [claimantUserId]);
        const claimantName = userNameRes.rows[0]?.name || claimantUserId;

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser ? actingUser.id : claimantUserId,
                'START_DUSTBIN_CYCLE',
                'dustbin_cycle',
                String(newCycle.id),
                `New dustbin cycle opened by ${claimantUserId}`,
                JSON.stringify({ claimantUserId, startDate: kolkataToday })
            ]
        );

        await client.query('COMMIT');

        return {
            id: newCycle.id,
            householdId: newCycle.household_id,
            claimantUserId: newCycle.claimant_user_id,
            claimantName,
            cycleStartDate: newCycle.cycle_start_date,
            status: newCycle.status,
            createdAt: newCycle.created_at
        };
    } catch (err) {
        await client.query('ROLLBACK');
        // Handle race conditions caught by partial unique index idx_dustbin_open_cycle
        if (err.code === '23505') {
            const conflictError = new Error('Another dustbin cycle was opened concurrently. Please refresh.');
            conflictError.status = 409;
            throw conflictError;
        }
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Complete the open dustbin cycle.
 * Only the current claimant or an ADMIN can mark it COMPLETED.
 */
async function completeDustbinCycle(householdId, cycleId, actingUser) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const cycleRes = await client.query(
            `SELECT id, household_id, claimant_user_id, status
             FROM dustbin_cycles
             WHERE id = $1 FOR UPDATE`,
            [cycleId]
        );

        if (cycleRes.rows.length === 0) {
            const error = new Error('Dustbin cycle not found');
            error.status = 404;
            throw error;
        }

        const cycle = cycleRes.rows[0];

        if (cycle.household_id !== householdId) {
            const error = new Error('Forbidden: Cycle belongs to another household');
            error.status = 403;
            throw error;
        }

        if (cycle.status === 'COMPLETED') {
            await client.query('COMMIT');
            return {
                id: cycle.id,
                status: 'COMPLETED',
                message: 'Cycle is already completed'
            };
        }

        // Authorization check: only claimant or admin can complete
        if (actingUser.role !== 'ADMIN' && cycle.claimant_user_id !== actingUser.id) {
            const error = new Error('Forbidden: Only the claimant or an administrator can complete this cycle');
            error.status = 403;
            throw error;
        }

        const updateRes = await client.query(
            `UPDATE dustbin_cycles
             SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id, household_id, claimant_user_id, TO_CHAR(cycle_start_date, 'YYYY-MM-DD') as cycle_start_date, status, updated_at`,
            [cycleId]
        );

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'COMPLETE_DUSTBIN_CYCLE',
                'dustbin_cycle',
                String(cycleId),
                `Dustbin cycle marked as COMPLETED by ${actingUser.id}`,
                JSON.stringify({ cycleId, completedBy: actingUser.id })
            ]
        );

        await client.query('COMMIT');

        const updated = updateRes.rows[0];
        return {
            id: updated.id,
            householdId: updated.household_id,
            claimantUserId: updated.claimant_user_id,
            cycleStartDate: updated.cycle_start_date,
            status: updated.status,
            updatedAt: updated.updated_at
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Fetch dustbin cycle history for the household.
 */
async function getDustbinHistory(householdId, { limit = 20, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const res = await db.query(
        `SELECT 
            dc.id,
            dc.household_id,
            dc.claimant_user_id,
            u.name as claimant_name,
            TO_CHAR(dc.cycle_start_date, 'YYYY-MM-DD') as cycle_start_date,
            dc.status,
            dc.created_at,
            dc.updated_at
         FROM dustbin_cycles dc
         LEFT JOIN users u ON dc.claimant_user_id = u.id
         WHERE dc.household_id = $1
         ORDER BY dc.created_at DESC, dc.id DESC
         LIMIT $2 OFFSET $3`,
        [householdId, safeLimit, safeOffset]
    );

    return res.rows.map(r => ({
        id: r.id,
        householdId: r.household_id,
        claimantUserId: r.claimant_user_id,
        claimantName: r.claimant_name || 'Unassigned',
        cycleStartDate: r.cycle_start_date,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    }));
}

/**
 * Helper to create an assignment (useful for seeding and testing)
 */
async function createAssignment(householdId, { choreId, userId, assignedDate, dueDate }) {
    const client = await db.pool.connect();
    try {
        // Ensure chore belongs to household
        const defCheck = await client.query('SELECT id FROM chore_definitions WHERE id = $1 AND household_id = $2', [choreId, householdId]);
        if (defCheck.rows.length === 0) {
            const error = new Error('Chore definition not found for household');
            error.status = 404;
            throw error;
        }

        const res = await client.query(
            `INSERT INTO chore_assignments (chore_id, user_id, assigned_date, due_date, status)
             VALUES ($1, $2, $3, $4, 'PENDING')
             ON CONFLICT (chore_id, assigned_date, user_id) WHERE user_id IS NOT NULL DO NOTHING
             RETURNING id, chore_id, user_id, TO_CHAR(assigned_date, 'YYYY-MM-DD') as assigned_date,
                       TO_CHAR(due_date, 'YYYY-MM-DD') as due_date, status, created_at`,
            [choreId, userId, assignedDate, dueDate]
        );

        if (res.rows.length === 0) {
            // Already exists
            const existing = await client.query(
                `SELECT id, chore_id, user_id, TO_CHAR(assigned_date, 'YYYY-MM-DD') as assigned_date,
                        TO_CHAR(due_date, 'YYYY-MM-DD') as due_date, status
                 FROM chore_assignments
                 WHERE chore_id = $1 AND user_id = $2 AND assigned_date = $3`,
                [choreId, userId, assignedDate]
            );
            return existing.rows[0];
        }

        return res.rows[0];
    } finally {
        client.release();
    }
}

module.exports = {
    getVesselSchedule,
    updateVesselSchedule,
    getAssignments,
    updateAssignmentStatus,
    getCurrentDustbinCycle,
    claimDustbinCycle,
    completeDustbinCycle,
    getDustbinHistory,
    createAssignment
};
