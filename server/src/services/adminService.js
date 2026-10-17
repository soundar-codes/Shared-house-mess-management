const db = require('../utils/db');
const { getActiveFoodConfig } = require('./foodService');
const { getLatestAutomationStatus, getBills, getMemberCycleSummary, calculateIntervalBreakdown } = require('./billingService');
const { getKolkataDateParts } = require('../utils/dateUtils');
const { hashPassword } = require('./authService');

/**
 * Returns complete Admin Overview statistics and metrics.
 */
async function getAdminOverview(householdId) {
    const todayStr = getKolkataDateParts().dateStr;

    // 1. Members count
    const membersRes = await db.query(
        `SELECT hm.user_id, hm.role, hm.is_active, u.name
         FROM household_memberships hm
         JOIN users u ON hm.user_id = u.id
         WHERE hm.household_id = $1`,
        [householdId]
    );
    const totalMembers = membersRes.rows.length;
    const activeMembers = membersRes.rows.filter(m => m.is_active).length;

    // 2. Current daily food rate
    const config = await getActiveFoodConfig(householdId);
    const dailyRatePaise = config ? config.default_rate_paise : 13000;

    // 3. Today's attendance summary
    const todayRecordsRes = await db.query(
        `SELECT status, count(*) as count
         FROM food_records
         WHERE household_id = $1 AND record_date = $2
         GROUP BY status`,
        [householdId, todayStr]
    );
    const todayStats = { ate: 0, cancelled: 0, onLeave: 0, sparse: 0 };
    let recordedCount = 0;
    todayRecordsRes.rows.forEach(r => {
        const cnt = parseInt(r.count, 10);
        recordedCount += cnt;
        if (r.status === 'CANCELLED') todayStats.cancelled += cnt;
        else if (r.status === 'ON_LEAVE') todayStats.onLeave += cnt;
        else if (r.status === 'FOOD_REQUIRED') todayStats.ate += cnt;
    });
    // Any active member without explicit row defaults to FOOD_REQUIRED (Ate)
    const sparseCount = Math.max(0, activeMembers - recordedCount);
    todayStats.ate += sparseCount;
    todayStats.sparse = sparseCount;

    // 4. Active leave periods
    const leavesRes = await db.query(
        `SELECT l.id, l.user_id, u.name as user_name,
                TO_CHAR(l.start_date, 'YYYY-MM-DD') as start_date,
                TO_CHAR(l.end_date, 'YYYY-MM-DD') as end_date,
                l.reason, l.status
         FROM member_leaves l
         JOIN users u ON l.user_id = u.id
         WHERE l.household_id = $1 AND l.status = 'ACTIVE'
           AND l.end_date >= $2
         ORDER BY l.start_date ASC`,
        [householdId, todayStr]
    );

    // 5. Billing totals across current bills
    const currentMonth = todayStr.substring(0, 7);
    const billsRes = await db.query(
        `SELECT total_amount_paise, paid_amount_paise, status
         FROM bills
         WHERE household_id = $1`,
        [householdId]
    );
    let totalBilledPaise = 0;
    let totalPaidPaise = 0;
    let pendingBillsCount = 0;
    billsRes.rows.forEach(b => {
        totalBilledPaise += b.total_amount_paise;
        totalPaidPaise += b.paid_amount_paise;
        if (b.paid_amount_paise < b.total_amount_paise) {
            pendingBillsCount++;
        }
    });
    const outstandingPaise = Math.max(0, totalBilledPaise - totalPaidPaise);

    // 6. Recent audit logs
    const auditRes = await db.query(
        `SELECT a.id, a.actor_id, u.name as actor_name, a.action, a.entity_type, 
                a.entity_id, a.reason, a.details, a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON a.actor_id = u.id
         ORDER BY a.created_at DESC
         LIMIT 10`
    );

    // 7. Latest automation status
    const autoStatus = await getLatestAutomationStatus(householdId);

    // 8. Household settings
    const hhRes = await db.query(
        `SELECT id, name, timezone, cancellation_cutoff_time
         FROM households
         WHERE id = $1`,
        [householdId]
    );
    const household = hhRes.rows[0] || { name: 'Shared House', timezone: 'Asia/Kolkata', cancellation_cutoff_time: '23:00' };

    return {
        totalMembers,
        activeMembers,
        dailyRatePaise,
        dailyRateRupees: dailyRatePaise / 100,
        todayDate: todayStr,
        todayStats,
        activeLeaves: leavesRes.rows,
        billingSummary: {
            totalBilledPaise,
            totalPaidPaise,
            outstandingPaise,
            pendingBillsCount,
            totalBillsCount: billsRes.rows.length
        },
        recentAuditLogs: auditRes.rows,
        automationStatus: autoStatus,
        householdSettings: household
    };
}

/**
 * Returns detailed members list with account status, cycle, bills, and outstanding balance.
 */
async function getAdminMembers(householdId) {
    const todayStr = getKolkataDateParts().dateStr;
    const membersRes = await db.query(
        `SELECT 
            u.id, 
            u.name, 
            u.created_at,
            hm.role, 
            hm.is_active,
            TO_CHAR(hm.mess_start_date, 'YYYY-MM-DD') as mess_start_date,
            hm.joined_at
         FROM household_memberships hm
         JOIN users u ON hm.user_id = u.id
         WHERE hm.household_id = $1
         ORDER BY u.name ASC`,
        [householdId]
    );

    // Get financial stats per member
    const billStatsRes = await db.query(
        `SELECT user_id, 
                COALESCE(SUM(total_amount_paise), 0) as total_billed,
                COALESCE(SUM(paid_amount_paise), 0) as total_paid
         FROM bills
         WHERE household_id = $1
         GROUP BY user_id`,
        [householdId]
    );
    const statsMap = new Map();
    billStatsRes.rows.forEach(r => {
        statsMap.set(r.user_id, {
            totalBilledPaise: parseInt(r.total_billed, 10),
            totalPaidPaise: parseInt(r.total_paid, 10),
            balancePaise: Math.max(0, parseInt(r.total_billed, 10) - parseInt(r.total_paid, 10))
        });
    });

    return membersRes.rows.map(m => {
        const fin = statsMap.get(m.id) || { totalBilledPaise: 0, totalPaidPaise: 0, balancePaise: 0 };
        return {
            id: m.id,
            name: m.name,
            role: m.role,
            isActive: m.is_active,
            messStartDate: m.mess_start_date,
            joinedAt: m.joined_at,
            createdAt: m.created_at,
            financials: fin
        };
    });
}

/**
 * Updates member role or active status (Admin only).
 */
async function updateMemberAccount(householdId, targetUserId, updates, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can modify member accounts');
        error.status = 403;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const memberRes = await client.query(
            `SELECT hm.user_id, hm.role, hm.is_active, u.name
             FROM household_memberships hm
             JOIN users u ON hm.user_id = u.id
             WHERE hm.household_id = $1 AND hm.user_id = $2
             FOR UPDATE`,
            [householdId, targetUserId]
        );

        if (memberRes.rows.length === 0) {
            const error = new Error('Member not found in household');
            error.status = 404;
            throw error;
        }

        const currentMember = memberRes.rows[0];
        const newRole = updates.role !== undefined ? updates.role : currentMember.role;
        const newIsActive = updates.isActive !== undefined ? Boolean(updates.isActive) : currentMember.is_active;

        if (!['ADMIN', 'MEMBER'].includes(newRole)) {
            const error = new Error("Role must be 'ADMIN' or 'MEMBER'");
            error.status = 400;
            throw error;
        }

        // Prevent self-deactivation or revoking admin on the last admin
        if (targetUserId === actingUser.id && newRole !== 'ADMIN') {
            const adminCountRes = await client.query(
                `SELECT count(*) FROM household_memberships WHERE household_id = $1 AND role = 'ADMIN'`,
                [householdId]
            );
            if (parseInt(adminCountRes.rows[0].count, 10) <= 1) {
                const error = new Error('Cannot revoke admin role on the only household administrator');
                error.status = 400;
                throw error;
            }
        }

        const updateRes = await client.query(
            `UPDATE household_memberships
             SET role = $1, is_active = $2
             WHERE household_id = $3 AND user_id = $4
             RETURNING household_id, user_id, role, is_active, mess_start_date`,
            [newRole, newIsActive, householdId, targetUserId]
        );

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'ADMIN_UPDATE_MEMBER',
                'household_membership',
                `${householdId}_${targetUserId}`,
                updates.reason || 'Admin updated member account details',
                JSON.stringify({
                    targetUserId,
                    oldRole: currentMember.role,
                    newRole,
                    oldIsActive: currentMember.is_active,
                    newIsActive
                })
            ]
        );

        await client.query('COMMIT');
        const row = updateRes.rows[0];
        return {
            ...row,
            userId: row.user_id,
            isActive: row.is_active,
            messStartDate: row.mess_start_date
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Creates a new member in the household (Admin only).
 */
async function createHouseholdMember(householdId, { userId, name, password, role = 'MEMBER', messStartDate }, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can add household members');
        error.status = 403;
        throw error;
    }

    if (!userId || !name || !password) {
        const error = new Error('userId, name, and password are required');
        error.status = 400;
        throw error;
    }

    if (!['ADMIN', 'MEMBER'].includes(role)) {
        const error = new Error("Role must be 'ADMIN' or 'MEMBER'");
        error.status = 400;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Check if user already exists
        const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length > 0) {
            const error = new Error(`User with ID '${userId}' already exists`);
            error.status = 400;
            throw error;
        }

        const passwordHash = await hashPassword(password);

        // Insert into users
        await client.query(
            `INSERT INTO users (id, name, password_hash)
             VALUES ($1, $2, $3)`,
            [userId, name, passwordHash]
        );

        // Insert into household_memberships
        const hmRes = await client.query(
            `INSERT INTO household_memberships (household_id, user_id, role, mess_start_date, is_active)
             VALUES ($1, $2, $3, $4, TRUE)
             RETURNING household_id, user_id, role, is_active, mess_start_date, joined_at`,
            [householdId, userId, role, messStartDate || null]
        );

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'ADMIN_CREATE_MEMBER',
                'user',
                userId,
                `Added new member ${name} (${role})`,
                JSON.stringify({ userId, name, role, messStartDate })
            ]
        );

        await client.query('COMMIT');
        return {
            id: userId,
            name,
            role: hmRes.rows[0].role,
            isActive: hmRes.rows[0].is_active,
            messStartDate: hmRes.rows[0].mess_start_date,
            joinedAt: hmRes.rows[0].joined_at
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Updates household configuration (daily food rate, cancellation cutoff, timezone) (Admin only).
 * Changes to pricing close the old food_configuration row and create a new active row.
 */
async function updateHouseholdSettings(householdId, { defaultRatePaise, cancellationCutoffTime, timezone }, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can update household settings');
        error.status = 403;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Update household attributes if provided
        if (cancellationCutoffTime !== undefined || timezone !== undefined) {
            await client.query(
                `UPDATE households
                 SET cancellation_cutoff_time = COALESCE($1, cancellation_cutoff_time),
                     timezone = COALESCE($2, timezone)
                 WHERE id = $3`,
                [cancellationCutoffTime || null, timezone || null, householdId]
            );
        }

        // 2. If rate changed, close current active rate and insert new configuration
        let newRatePaise = null;
        if (defaultRatePaise !== undefined) {
            const parsedRate = parseInt(defaultRatePaise, 10);
            if (isNaN(parsedRate) || parsedRate <= 0) {
                const error = new Error('defaultRatePaise must be a positive integer in paise (e.g. 13000 for ₹130)');
                error.status = 400;
                throw error;
            }

            // Close existing
            await client.query(
                `UPDATE food_configuration
                 SET valid_to = CURRENT_TIMESTAMP
                 WHERE household_id = $1 AND valid_to IS NULL`,
                [householdId]
            );

            // Insert new configuration
            const insRes = await client.query(
                `INSERT INTO food_configuration (household_id, default_rate_paise, valid_from)
                 VALUES ($1, $2, CURRENT_TIMESTAMP)
                 RETURNING id, default_rate_paise, valid_from`,
                [householdId, parsedRate]
            );
            newRatePaise = insRes.rows[0].default_rate_paise;
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'ADMIN_UPDATE_SETTINGS',
                'household_settings',
                String(householdId),
                'Updated household settings / daily food rate',
                JSON.stringify({ householdId, defaultRatePaise: newRatePaise, cancellationCutoffTime, timezone })
            ]
        );

        await client.query('COMMIT');

        const activeConf = await getActiveFoodConfig(householdId);
        const hhRes = await db.query('SELECT id, name, timezone, cancellation_cutoff_time FROM households WHERE id = $1', [householdId]);

        return {
            household: hhRes.rows[0],
            foodConfig: activeConf
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Returns audit logs with optional pagination and action filter.
 */
async function getAuditLogs(householdId, { limit = 50, offset = 0, action = null } = {}) {
    let queryText = `
        SELECT a.id, a.actor_id, u.name as actor_name, a.action, a.entity_type,
               a.entity_id, a.reason, a.details, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON a.actor_id = u.id
    `;
    const params = [];

    if (action) {
        params.push(action);
        queryText += ` WHERE a.action = $${params.length}`;
    }

    params.push(limit);
    params.push(offset);
    queryText += ` ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const res = await db.query(queryText, params);
    return res.rows;
}

/**
 * Returns household information (address, emergency contacts, wifi, rules) visible to all members.
 */
async function getHouseholdInformation(householdId) {
    const res = await db.query(
        `SELECT hi.id, hi.household_id, hi.address, hi.landmark, hi.pincode,
                hi.google_maps_url, hi.emergency_contacts, hi.wifi_ssid,
                hi.wifi_password, hi.house_rules, hi.notes, hi.updated_at,
                u.name as updated_by_name, h.name as household_name
         FROM household_information hi
         JOIN households h ON hi.household_id = h.id
         LEFT JOIN users u ON hi.updated_by = u.id
         WHERE hi.household_id = $1`,
        [householdId]
    );

    if (res.rows.length === 0) {
        // Return default skeleton
        const hh = await db.query('SELECT name FROM households WHERE id = $1', [householdId]);
        return {
            householdId,
            householdName: hh.rows[0]?.name || 'Shared House',
            address: '',
            landmark: '',
            pincode: '',
            googleMapsUrl: '',
            emergencyContacts: [],
            wifiSsid: '',
            wifiPassword: '',
            houseRules: '',
            notes: '',
            updatedAt: null,
            updatedByName: null
        };
    }

    const r = res.rows[0];
    return {
        id: r.id,
        householdId: r.household_id,
        householdName: r.household_name,
        address: r.address || '',
        landmark: r.landmark || '',
        pincode: r.pincode || '',
        googleMapsUrl: r.google_maps_url || '',
        emergencyContacts: r.emergency_contacts || [],
        wifiSsid: r.wifi_ssid || '',
        wifiPassword: r.wifi_password || '',
        houseRules: r.house_rules || '',
        notes: r.notes || '',
        updatedAt: r.updated_at,
        updatedByName: r.updated_by_name
    };
}

/**
 * Updates household information (Admin only).
 */
async function updateHouseholdInformation(householdId, data, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can update household information');
        error.status = 403;
        throw error;
    }

    const {
        address,
        landmark,
        pincode,
        googleMapsUrl,
        emergencyContacts,
        wifiSsid,
        wifiPassword,
        houseRules,
        notes
    } = data;

    const contactsJson = Array.isArray(emergencyContacts) 
        ? JSON.stringify(emergencyContacts) 
        : (typeof emergencyContacts === 'string' ? emergencyContacts : '[]');

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const upsertRes = await client.query(
            `INSERT INTO household_information 
                (household_id, address, landmark, pincode, google_maps_url, emergency_contacts, wifi_ssid, wifi_password, house_rules, notes, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
             ON CONFLICT (household_id) DO UPDATE SET
                address = EXCLUDED.address,
                landmark = EXCLUDED.landmark,
                pincode = EXCLUDED.pincode,
                google_maps_url = EXCLUDED.google_maps_url,
                emergency_contacts = EXCLUDED.emergency_contacts,
                wifi_ssid = EXCLUDED.wifi_ssid,
                wifi_password = EXCLUDED.wifi_password,
                house_rules = EXCLUDED.house_rules,
                notes = EXCLUDED.notes,
                updated_by = EXCLUDED.updated_by,
                updated_at = CURRENT_TIMESTAMP
             RETURNING id, household_id, address, landmark, pincode, google_maps_url, emergency_contacts, wifi_ssid, wifi_password, house_rules, notes, updated_at`,
            [
                householdId,
                address || null,
                landmark || null,
                pincode || null,
                googleMapsUrl || null,
                contactsJson,
                wifiSsid || null,
                wifiPassword || null,
                houseRules || null,
                notes || null,
                actingUser.id
            ]
        );

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'UPDATE_HOUSEHOLD_INFO',
                'household_information',
                String(householdId),
                'Admin updated household address, emergency contacts, or house details',
                JSON.stringify({ householdId, address, wifiSsid, landmark })
            ]
        );

        await client.query('COMMIT');
        return getHouseholdInformation(householdId);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    getAdminOverview,
    getAdminMembers,
    updateMemberAccount,
    createHouseholdMember,
    updateHouseholdSettings,
    getAuditLogs,
    getHouseholdInformation,
    updateHouseholdInformation
};
