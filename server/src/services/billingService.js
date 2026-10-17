const db = require('../utils/db');
const { 
    getMonthBoundaries, 
    getKolkataDateParts, 
    calculateBillingCycle, 
    getCurrentBillingCycle, 
    getDatesInInterval 
} = require('../utils/dateUtils');

/**
 * Returns all configured food rates for a household.
 */
async function getHouseholdFoodConfigs(householdId, client = db) {
    const res = await client.query(
        `SELECT id, default_rate_paise, valid_from, valid_to
         FROM food_configuration
         WHERE household_id = $1
         ORDER BY valid_from ASC`,
        [householdId]
    );
    return res.rows;
}

/**
 * Resolves the rate active on a specific calendar date (YYYY-MM-DD).
 * Date is evaluated at the end of the day 23:59:59.999 IST (+05:30)
 */
function resolveRateForDate(configs, dateStr) {
    const targetTime = new Date(`${dateStr}T23:59:59.999+05:30`).getTime();
    
    // Find matching configuration where valid_from <= targetTime and (valid_to is null or valid_to >= targetTime)
    for (let i = configs.length - 1; i >= 0; i--) {
        const conf = configs[i];
        const validFromTime = new Date(conf.valid_from).getTime();
        const validToTime = conf.valid_to ? new Date(conf.valid_to).getTime() : Infinity;

        if (validFromTime <= targetTime && targetTime <= validToTime) {
            return conf.default_rate_paise;
        }
    }

    // Fallback to latest or standard default (13000 paise = Rs 130)
    return configs.length > 0 ? configs[configs.length - 1].default_rate_paise : 13000;
}

/**
 * Fetches household members with their configured mess start dates, roles, and current billing cycle status.
 * If actingUser is MEMBER, returns only their own record.
 * If actingUser is ADMIN, returns all members in the household.
 */
async function getMemberCycleSummary(householdId, actingUser = null) {
    const todayStr = getKolkataDateParts().dateStr;
    let queryText = `
        SELECT 
            u.id as user_id, 
            u.name as user_name, 
            m.role, 
            TO_CHAR(m.mess_start_date, 'YYYY-MM-DD') as mess_start_date
         FROM household_memberships m
         JOIN users u ON m.user_id = u.id
         WHERE m.household_id = $1
    `;
    const params = [householdId];

    if (actingUser && actingUser.role !== 'ADMIN') {
        params.push(actingUser.id);
        queryText += ` AND m.user_id = $${params.length}`;
    }

    queryText += ` ORDER BY u.name ASC`;

    const res = await db.query(queryText, params);

    // Also fetch active bills for these members to check generation status and payments
    const billsRes = await db.query(
        `SELECT id, user_id, TO_CHAR(period_start, 'YYYY-MM-DD') as period_start, 
                TO_CHAR(period_end, 'YYYY-MM-DD') as period_end, status, total_amount_paise, paid_amount_paise
         FROM bills
         WHERE household_id = $1`,
        [householdId]
    );
    const billsMap = new Map();
    billsRes.rows.forEach(b => {
        billsMap.set(`${b.user_id}_${b.period_start}_${b.period_end}`, b);
    });

    const calculatedAt = new Date().toISOString();

    const membersSummary = await Promise.all(res.rows.map(async m => {
        let periodStart;
        let periodEnd;
        let nextBillingDate;
        let cycleIndex = null;

        if (m.mess_start_date) {
            const cycle = getCurrentBillingCycle(m.mess_start_date, todayStr);
            periodStart = cycle.startDate;
            periodEnd = cycle.endDate;
            nextBillingDate = cycle.nextBillingDate;
            cycleIndex = cycle.cycleIndex;
        } else {
            // Calendar month check: [YYYY-MM-01, next month 01)
            const currentMonthStr = todayStr.substring(0, 7);
            const { startDate: calStart } = getMonthBoundaries(currentMonthStr);
            const [y, mon] = currentMonthStr.split('-').map(Number);
            const nextM = mon === 12 ? 1 : mon + 1;
            const nextY = mon === 12 ? y + 1 : y;
            periodStart = calStart;
            periodEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
            nextBillingDate = periodEnd;
        }

        const key = `${m.user_id}_${periodStart}_${periodEnd}`;
        const existingBill = billsMap.get(key);
        const isBillGenerated = !!existingBill;
        const billStatus = existingBill ? existingBill.status : null;
        const billId = existingBill ? existingBill.id : null;

        // Dynamic interval breakdown for this member over the active cycle [periodStart, periodEnd)
        const breakdownData = await calculateIntervalBreakdown(
            householdId,
            m.user_id,
            periodStart,
            periodEnd
        );

        // Calculate today's food charge and status
        const todayEntry = breakdownData.dailyBreakdown.find(d => d.date === todayStr);
        let todayFoodChargePaise = 0;
        let todayFoodStatus = 'NOT_IN_CYCLE';

        if (todayEntry) {
            todayFoodStatus = todayEntry.status;
            todayFoodChargePaise = todayEntry.chargedPaise || 0;
        }

        // Amount paid & remaining balance
        const paidAmountPaise = existingBill ? existingBill.paid_amount_paise : 0;
        const totalAmountPaise = existingBill 
            ? (existingBill.status === 'FINALIZED' ? existingBill.total_amount_paise : breakdownData.totalPaise)
            : breakdownData.totalPaise;
        const remainingBalancePaise = Math.max(0, totalAmountPaise - paidAmountPaise);

        return {
            userId: m.user_id,
            userName: m.user_name,
            role: m.role,
            messStartDate: m.mess_start_date,
            isBillGenerated,
            billStatus,
            billId,
            currentCycle: {
                periodStart,
                periodEnd,
                nextBillingDate,
                cycleIndex,
                totalDays: breakdownData.dailyBreakdown.length,
                chargeableDays: breakdownData.chargeableDays,
                cancelledDays: breakdownData.cancelledDays,
                leaveDays: breakdownData.leaveDays,
                messUnavailableDays: breakdownData.messUnavailableDays,
                accumulatedFoodPaise: breakdownData.totalPaise,
                todayFoodChargePaise,
                todayFoodStatus,
                paidAmountPaise,
                remainingBalancePaise,
                totalAmountPaise,
                calculatedAt
            }
        };
    }));

    return membersSummary;
}

/**
 * Updates a member's mess service start date (Admin only).
 */
async function updateMemberMessStartDate(householdId, targetUserId, messStartDate, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can update member mess start dates');
        error.status = 403;
        throw error;
    }

    if (!messStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(messStartDate)) {
        const error = new Error('Valid messStartDate (YYYY-MM-DD) is required');
        error.status = 400;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const memberRes = await client.query(
            `SELECT user_id, TO_CHAR(mess_start_date, 'YYYY-MM-DD') as old_date
             FROM household_memberships
             WHERE household_id = $1 AND user_id = $2
             FOR UPDATE`,
            [householdId, targetUserId]
        );

        if (memberRes.rows.length === 0) {
            const error = new Error('Member not found in household');
            error.status = 404;
            throw error;
        }

        const oldDate = memberRes.rows[0].old_date;

        const updateRes = await client.query(
            `UPDATE household_memberships
             SET mess_start_date = $1
             WHERE household_id = $2 AND user_id = $3
             RETURNING household_id, user_id, TO_CHAR(mess_start_date, 'YYYY-MM-DD') as mess_start_date`,
            [messStartDate, householdId, targetUserId]
        );

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'UPDATE_MESS_START_DATE',
                'household_membership',
                `${householdId}_${targetUserId}`,
                `Mess start date updated to ${messStartDate}`,
                JSON.stringify({ householdId, targetUserId, oldDate, newDate: messStartDate })
            ]
        );

        await client.query('COMMIT');
        return updateRes.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Calculates and returns daily breakdown and total paise for a specific date interval [startDate, endDate)
 * (start-inclusive, end-exclusive).
 */
async function calculateIntervalBreakdown(householdId, userId, startDate, endDate, client = db) {
    const dates = getDatesInInterval(startDate, endDate);
    if (dates.length === 0) {
        return { totalPaise: 0, chargeableDays: 0, cancelledDays: 0, messUnavailableDays: 0, dailyBreakdown: [] };
    }

    const configs = await getHouseholdFoodConfigs(householdId, client);

    // Fetch mess unavailabilities covering the interval
    const unavailRes = await client.query(
        `SELECT TO_CHAR(declaration_date, 'YYYY-MM-DD') as declaration_date, reason
         FROM mess_unavailability_declarations
         WHERE household_id = $1 AND status = 'ACTIVE'
         AND declaration_date >= $2 AND declaration_date <= $3`,
        [householdId, startDate, dates[dates.length - 1]]
    );
    const unavailMap = new Map();
    unavailRes.rows.forEach(u => unavailMap.set(u.declaration_date, u.reason));

    // Fetch food records for member covering interval
    const foodRes = await client.query(
        `SELECT TO_CHAR(record_date, 'YYYY-MM-DD') as date, status, rate_paise
         FROM food_records
         WHERE household_id = $1 AND user_id = $2
         AND record_date >= $3 AND record_date <= $4`,
        [householdId, userId, startDate, dates[dates.length - 1]]
    );
    const foodRecordMap = new Map();
    foodRes.rows.forEach(r => foodRecordMap.set(r.date, r));

    let totalPaise = 0;
    let chargeableDays = 0;
    let cancelledDays = 0;
    let leaveDays = 0;
    let messUnavailableDays = 0;
    const dailyBreakdown = [];

    for (const dayStr of dates) {
        const record = foodRecordMap.get(dayStr);
        const isMessUnavail = unavailMap.has(dayStr);

        if (isMessUnavail) {
            messUnavailableDays++;
            dailyBreakdown.push({
                date: dayStr,
                status: 'MESS_UNAVAILABLE',
                reason: unavailMap.get(dayStr),
                ratePaise: 0,
                chargedPaise: 0,
                source: 'mess_declaration'
            });
        } else if (record) {
            if (record.status === 'CANCELLED') {
                cancelledDays++;
                dailyBreakdown.push({
                    date: dayStr,
                    status: 'CANCELLED',
                    ratePaise: 0,
                    chargedPaise: 0,
                    source: 'food_records'
                });
            } else if (record.status === 'ON_LEAVE') {
                leaveDays++;
                dailyBreakdown.push({
                    date: dayStr,
                    status: 'ON_LEAVE',
                    ratePaise: 0,
                    chargedPaise: 0,
                    source: 'leave_record'
                });
            } else {
                chargeableDays++;
                totalPaise += record.rate_paise;
                dailyBreakdown.push({
                    date: dayStr,
                    status: 'FOOD_REQUIRED',
                    ratePaise: record.rate_paise,
                    chargedPaise: record.rate_paise,
                    source: 'food_records'
                });
            }
        } else {
            // Sparse record default
            const rateForDay = resolveRateForDate(configs, dayStr);
            chargeableDays++;
            totalPaise += rateForDay;
            dailyBreakdown.push({
                date: dayStr,
                status: 'FOOD_REQUIRED',
                ratePaise: rateForDay,
                chargedPaise: rateForDay,
                source: 'default_policy'
            });
        }
    }

    return {
        totalPaise,
        chargeableDays,
        cancelledDays,
        leaveDays,
        messUnavailableDays,
        dailyBreakdown
    };
}

/**
 * Generates bills for all members based on either:
 * - billingMonth (e.g. '2026-10'): If members have mess_start_date, calculates their cycle containing this month or anchor;
 *   if members don't have mess_start_date, defaults to calendar month [YYYY-MM-01, next month).
 * - cycleIndex: (Optional) generate specific cycle index for members with start dates.
 */
async function generateMonthlyBills(householdId, billingMonth, actingUser, options = {}) {
    if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
        const error = new Error('Invalid billing month format. Must be YYYY-MM');
        error.status = 400;
        throw error;
    }

    const { startDate: calStartDate, endDate: calEndDate } = getMonthBoundaries(billingMonth);

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch household members with mess_start_date
        const membersRes = await client.query(
            `SELECT u.id, u.name, m.role, TO_CHAR(m.mess_start_date, 'YYYY-MM-DD') as mess_start_date
             FROM household_memberships m
             JOIN users u ON m.user_id = u.id
             WHERE m.household_id = $1
             ORDER BY u.name ASC`,
            [householdId]
        );
        const members = membersRes.rows;
        const results = [];

        for (const member of members) {
            let periodStart;
            let periodEnd;
            let cycleIndex = null;

            if (member.mess_start_date) {
                // Determine cycle for this member
                if (options.cycleIndex !== undefined) {
                    const c = calculateBillingCycle(member.mess_start_date, options.cycleIndex);
                    periodStart = c.startDate;
                    periodEnd = c.endDate;
                    cycleIndex = c.cycleIndex;
                } else {
                    // Match the cycle whose startDate falls in or aligns with billingMonth
                    const targetDate = `${billingMonth}-${member.mess_start_date.split('-')[2]}`;
                    const c = getCurrentBillingCycle(member.mess_start_date, targetDate);
                    periodStart = c.startDate;
                    periodEnd = c.endDate;
                    cycleIndex = c.cycleIndex;
                }
            } else {
                // Default to calendar month: [YYYY-MM-01, YYYY-(MM+1)-01)
                periodStart = calStartDate;
                const [y, m] = billingMonth.split('-').map(Number);
                const nextM = m === 12 ? 1 : m + 1;
                const nextY = m === 12 ? y + 1 : y;
                periodEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
            }

            // Check existing bill for this member and (period_start, period_end) OR legacy billing_month
            const existingBillRes = await client.query(
                `SELECT id, household_id, user_id, billing_month, period_start, period_end,
                        total_amount_paise, paid_amount_paise, status, snapshot_data
                 FROM bills
                 WHERE household_id = $1 AND user_id = $2 
                   AND ((period_start = $3 AND period_end = $4) OR (billing_month = $5 AND period_start IS NULL))
                 FOR UPDATE`,
                [householdId, member.id, periodStart, periodEnd, billingMonth]
            );

            if (existingBillRes.rows.length > 0) {
                const existingBill = existingBillRes.rows[0];
                if (existingBill.status === 'FINALIZED') {
                    // Do not recalculate or overwrite FINALIZED bill
                    results.push({
                        ...existingBill,
                        userName: member.name,
                        action: 'PRESERVED_FINALIZED'
                    });
                    continue;
                }
            }

            // Calculate daily breakdown for [periodStart, periodEnd)
            const breakdownData = await calculateIntervalBreakdown(
                householdId,
                member.id,
                periodStart,
                periodEnd,
                client
            );

            const snapshot = {
                billingMonth,
                periodStart,
                periodEnd,
                cycleIndex,
                nextBillingDate: periodEnd,
                messStartDate: member.mess_start_date,
                totalDays: breakdownData.dailyBreakdown.length,
                chargeableDays: breakdownData.chargeableDays,
                cancelledDays: breakdownData.cancelledDays,
                leaveDays: breakdownData.leaveDays || 0,
                messUnavailableDays: breakdownData.messUnavailableDays,
                generatedAt: new Date().toISOString(),
                generatedBy: actingUser ? actingUser.id : 'system',
                dailyBreakdown: breakdownData.dailyBreakdown
            };

            let bill;
            if (existingBillRes.rows.length > 0) {
                // Update existing OPEN or REOPENED bill
                const updRes = await client.query(
                    `UPDATE bills
                     SET total_amount_paise = $1,
                         snapshot_data = $2,
                         period_start = $3,
                         period_end = $4,
                         cycle_index = $5,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $6
                     RETURNING id, household_id, user_id, billing_month, 
                               TO_CHAR(period_start, 'YYYY-MM-DD') as period_start, 
                               TO_CHAR(period_end, 'YYYY-MM-DD') as period_end, 
                               cycle_index,
                               total_amount_paise, paid_amount_paise, status, snapshot_data, created_at, updated_at`,
                    [
                        breakdownData.totalPaise,
                        JSON.stringify(snapshot),
                        periodStart,
                        periodEnd,
                        cycleIndex,
                        existingBillRes.rows[0].id
                    ]
                );
                bill = updRes.rows[0];
            } else {
                // Insert new bill
                const insRes = await client.query(
                    `INSERT INTO bills (household_id, user_id, billing_month, period_start, period_end, cycle_index, total_amount_paise, snapshot_data, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN')
                     ON CONFLICT (household_id, user_id, billing_month)
                     DO UPDATE SET 
                        total_amount_paise = EXCLUDED.total_amount_paise,
                        snapshot_data = EXCLUDED.snapshot_data,
                        period_start = EXCLUDED.period_start,
                        period_end = EXCLUDED.period_end,
                        cycle_index = EXCLUDED.cycle_index,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE bills.status != 'FINALIZED'
                     RETURNING id, household_id, user_id, billing_month, 
                               TO_CHAR(period_start, 'YYYY-MM-DD') as period_start, 
                               TO_CHAR(period_end, 'YYYY-MM-DD') as period_end, 
                               cycle_index,
                               total_amount_paise, paid_amount_paise, status, snapshot_data, created_at, updated_at`,
                    [
                        householdId,
                        member.id,
                        billingMonth,
                        periodStart,
                        periodEnd,
                        cycleIndex,
                        breakdownData.totalPaise,
                        JSON.stringify(snapshot)
                    ]
                );
                bill = insRes.rows[0];
            }

            results.push({
                ...bill,
                userName: member.name,
                action: 'GENERATED'
            });
        }

        // Audit log the generation action
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser ? actingUser.id : null,
                'GENERATE_MONTHLY_BILLS',
                'household_bills',
                `${householdId}_${billingMonth}`,
                `Monthly bills generated for ${billingMonth}`,
                JSON.stringify({ householdId, billingMonth, count: results.length })
            ]
        );

        await client.query('COMMIT');
        return results;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Retrieves bills for a household, filtered by month or user authorization.
 */
async function getBills(householdId, { billingMonth, userId, actingUser } = {}) {
    let queryText = `
        SELECT 
            b.id,
            b.household_id,
            b.user_id,
            u.name as user_name,
            b.billing_month,
            TO_CHAR(b.period_start, 'YYYY-MM-DD') as period_start,
            TO_CHAR(b.period_end, 'YYYY-MM-DD') as period_end,
            b.cycle_index,
            TO_CHAR(m.mess_start_date, 'YYYY-MM-DD') as mess_start_date,
            b.total_amount_paise,
            b.paid_amount_paise,
            (b.total_amount_paise - b.paid_amount_paise) as balance_paise,
            b.status,
            b.snapshot_data,
            b.created_at,
            b.updated_at
        FROM bills b
        JOIN users u ON b.user_id = u.id
        LEFT JOIN household_memberships m ON b.household_id = m.household_id AND b.user_id = m.user_id
        WHERE b.household_id = $1
    `;
    const params = [householdId];

    // Authorization: Non-admins can only see their own bills
    if (actingUser.role !== 'ADMIN') {
        params.push(actingUser.id);
        queryText += ` AND b.user_id = $${params.length}`;
    } else if (userId) {
        params.push(userId);
        queryText += ` AND b.user_id = $${params.length}`;
    }

    if (billingMonth) {
        params.push(billingMonth);
        queryText += ` AND b.billing_month = $${params.length}`;
    }

    queryText += ` ORDER BY b.period_start DESC NULLS LAST, b.billing_month DESC, u.name ASC`;

    const res = await db.query(queryText, params);
    return res.rows.map(r => {
        const periodStart = r.period_start || (r.billing_month ? `${r.billing_month}-01` : null);
        const periodEnd = r.period_end || (r.billing_month ? getMonthBoundaries(r.billing_month).endDate : null);
        const nextBillingDate = periodEnd;

        return {
            id: r.id,
            householdId: r.household_id,
            userId: r.user_id,
            userName: r.user_name,
            billingMonth: r.billing_month,
            periodStart,
            periodEnd,
            nextBillingDate,
            cycleIndex: r.cycle_index,
            messStartDate: r.mess_start_date,
            totalAmountPaise: r.total_amount_paise,
            paidAmountPaise: r.paid_amount_paise,
            balancePaise: Math.max(0, r.balance_paise),
            status: r.status,
            paymentStatus: r.paid_amount_paise >= r.total_amount_paise && r.total_amount_paise > 0 ? 'PAID' : (r.paid_amount_paise > 0 ? 'PARTIAL' : 'PENDING'),
            snapshotData: r.snapshot_data,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        };
    });
}

/**
 * Fetch a single bill by ID with authorization checks.
 */
async function getBillById(householdId, billId, actingUser) {
    const res = await db.query(
        `SELECT 
            b.id,
            b.household_id,
            b.user_id,
            u.name as user_name,
            b.billing_month,
            TO_CHAR(b.period_start, 'YYYY-MM-DD') as period_start,
            TO_CHAR(b.period_end, 'YYYY-MM-DD') as period_end,
            b.cycle_index,
            TO_CHAR(m.mess_start_date, 'YYYY-MM-DD') as mess_start_date,
            b.total_amount_paise,
            b.paid_amount_paise,
            (b.total_amount_paise - b.paid_amount_paise) as balance_paise,
            b.status,
            b.snapshot_data,
            b.created_at,
            b.updated_at
        FROM bills b
        JOIN users u ON b.user_id = u.id
        LEFT JOIN household_memberships m ON b.household_id = m.household_id AND b.user_id = m.user_id
        WHERE b.id = $1 AND b.household_id = $2`,
        [billId, householdId]
    );

    if (res.rows.length === 0) {
        const error = new Error('Bill not found');
        error.status = 404;
        throw error;
    }

    const bill = res.rows[0];

    // Authorization
    if (actingUser.role !== 'ADMIN' && bill.user_id !== actingUser.id) {
        const error = new Error('Forbidden: You can only view your own bill');
        error.status = 403;
        throw error;
    }

    const periodStart = bill.period_start || (bill.billing_month ? `${bill.billing_month}-01` : null);
    const periodEnd = bill.period_end || (bill.billing_month ? getMonthBoundaries(bill.billing_month).endDate : null);

    return {
        id: bill.id,
        householdId: bill.household_id,
        userId: bill.user_id,
        userName: bill.user_name,
        billingMonth: bill.billing_month,
        periodStart,
        periodEnd,
        nextBillingDate: periodEnd,
        cycleIndex: bill.cycle_index,
        messStartDate: bill.mess_start_date,
        totalAmountPaise: bill.total_amount_paise,
        paidAmountPaise: bill.paid_amount_paise,
        balancePaise: Math.max(0, bill.balance_paise),
        status: bill.status,
        paymentStatus: bill.paid_amount_paise >= bill.total_amount_paise && bill.total_amount_paise > 0 ? 'PAID' : (bill.paid_amount_paise > 0 ? 'PARTIAL' : 'PENDING'),
        snapshotData: bill.snapshot_data,
        createdAt: bill.created_at,
        updatedAt: bill.updated_at
    };
}

/**
 * Record a payment against a bill with idempotency and overpayment validation.
 */
async function recordPayment(householdId, billId, { amountPaise, idempotencyKey, actingUser }) {
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
        const error = new Error('A unique idempotencyKey is required for payment processing');
        error.status = 400;
        throw error;
    }

    const parsedAmount = parseInt(amountPaise, 10);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        const error = new Error('Payment amount must be a positive integer in paise');
        error.status = 400;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Check if payment with this idempotency key already exists
        const existingPaymentRes = await client.query(
            `SELECT id, bill_id, amount_paise, idempotency_key, status, created_at
             FROM payments
             WHERE idempotency_key = $1
             FOR UPDATE`,
            [idempotencyKey]
        );

        if (existingPaymentRes.rows.length > 0) {
            const existingPayment = existingPaymentRes.rows[0];
            if (existingPayment.bill_id !== billId || existingPayment.amount_paise !== parsedAmount) {
                const error = new Error('Idempotency key collision: Payment already processed with different parameters');
                error.status = 409;
                throw error;
            }

            await client.query('COMMIT');
            return {
                id: existingPayment.id,
                billId: existingPayment.bill_id,
                amountPaise: existingPayment.amount_paise,
                idempotencyKey: existingPayment.idempotency_key,
                status: existingPayment.status,
                createdAt: existingPayment.created_at,
                isIdempotentReplay: true
            };
        }

        // Lock the target bill row FOR UPDATE
        const billRes = await client.query(
            `SELECT id, household_id, user_id, total_amount_paise, paid_amount_paise, status
             FROM bills
             WHERE id = $1 FOR UPDATE`,
            [billId]
        );

        if (billRes.rows.length === 0) {
            const error = new Error('Bill not found');
            error.status = 404;
            throw error;
        }

        const bill = billRes.rows[0];

        if (bill.household_id !== householdId) {
            const error = new Error('Forbidden: Bill belongs to another household');
            error.status = 403;
            throw error;
        }

        // Authorization: Only Admin can record payments
        if (actingUser.role !== 'ADMIN') {
            const error = new Error('Forbidden: Only administrators can record bill payments');
            error.status = 403;
            throw error;
        }

        // Check overpayment
        const remainingBalance = bill.total_amount_paise - bill.paid_amount_paise;
        if (parsedAmount > remainingBalance) {
            const error = new Error(`Overpayment not permitted. Maximum payable amount is ${remainingBalance} paise (₹${remainingBalance / 100})`);
            error.status = 400;
            throw error;
        }

        // Insert payment record
        const insertRes = await client.query(
            `INSERT INTO payments (bill_id, amount_paise, idempotency_key, status)
             VALUES ($1, $2, $3, 'VALID')
             RETURNING id, bill_id, amount_paise, idempotency_key, status, created_at`,
            [bill.id, parsedAmount, idempotencyKey]
        );

        const newPayment = insertRes.rows[0];

        // Atomically update bill's paid amount
        await client.query(
            `UPDATE bills 
             SET paid_amount_paise = paid_amount_paise + $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [parsedAmount, bill.id]
        );

        // Record in audit_logs
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'RECORD_PAYMENT',
                'bill_payment',
                String(newPayment.id),
                `Payment of ${parsedAmount} paise recorded for bill ${bill.id}`,
                JSON.stringify({
                    billId: bill.id,
                    amountPaise: parsedAmount,
                    idempotencyKey,
                    newPaidTotal: bill.paid_amount_paise + parsedAmount
                })
            ]
        );

        await client.query('COMMIT');
        return {
            id: newPayment.id,
            billId: newPayment.bill_id,
            amountPaise: newPayment.amount_paise,
            idempotencyKey: newPayment.idempotency_key,
            status: newPayment.status,
            createdAt: newPayment.created_at,
            isIdempotentReplay: false
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Retrieves payment history for a specific bill.
 */
async function getBillPayments(householdId, billId, actingUser) {
    const bill = await getBillById(householdId, billId, actingUser);

    const res = await db.query(
        `SELECT id, bill_id, amount_paise, idempotency_key, status, created_at
         FROM payments
         WHERE bill_id = $1
         ORDER BY created_at DESC, id DESC`,
        [bill.id]
    );

    return res.rows.map(p => ({
        id: p.id,
        billId: p.bill_id,
        amountPaise: p.amount_paise,
        idempotencyKey: p.idempotency_key,
        status: p.status,
        createdAt: p.created_at
    }));
}

/**
 * Revokes a previously recorded payment (Admin only).
 * Marks payment status as 'REVOKED', subtracts amount from bill's paid_amount_paise,
 * and creates an audit log entry.
 */
async function revokePayment(householdId, paymentId, { actingUser, reason } = {}) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can revoke payments');
        error.status = 403;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        // Lock payment row
        const paymentRes = await client.query(
            `SELECT p.id, p.bill_id, p.amount_paise, p.idempotency_key, p.status, p.created_at,
                    b.household_id, b.user_id, b.paid_amount_paise, b.total_amount_paise, b.status as bill_status
             FROM payments p
             JOIN bills b ON p.bill_id = b.id
             WHERE p.id = $1
             FOR UPDATE OF p, b`,
            [paymentId]
        );

        if (paymentRes.rows.length === 0) {
            const error = new Error('Payment not found');
            error.status = 404;
            throw error;
        }

        const payment = paymentRes.rows[0];

        if (payment.household_id !== householdId) {
            const error = new Error('Forbidden: Payment belongs to another household');
            error.status = 403;
            throw error;
        }

        if (payment.status === 'REVOKED') {
            const error = new Error('Payment has already been revoked');
            error.status = 400;
            throw error;
        }

        // Revoke the payment
        await client.query(
            `UPDATE payments
             SET status = 'REVOKED', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [payment.id]
        );

        // Deduct paid amount from bill (never going below 0)
        const updatedBillRes = await client.query(
            `UPDATE bills
             SET paid_amount_paise = GREATEST(0, paid_amount_paise - $1), updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING id, total_amount_paise, paid_amount_paise, status`,
            [payment.amount_paise, payment.bill_id]
        );

        const updatedBill = updatedBillRes.rows[0];

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'REVOKE_PAYMENT',
                'bill_payment',
                String(payment.id),
                reason || `Revoked payment of ${payment.amount_paise} paise on bill ${payment.bill_id}`,
                JSON.stringify({
                    paymentId: payment.id,
                    billId: payment.bill_id,
                    revokedAmountPaise: payment.amount_paise,
                    newPaidTotal: updatedBill.paid_amount_paise
                })
            ]
        );

        await client.query('COMMIT');

        return {
            id: payment.id,
            billId: payment.bill_id,
            amountPaise: payment.amount_paise,
            status: 'REVOKED',
            revokedAt: new Date().toISOString(),
            newPaidTotal: updatedBill.paid_amount_paise
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Updates a bill's paid amount directly (Admin only), e.g. setting to 0 (mark unpaid) or custom amount.
 */
async function updateBillPaidAmount(householdId, billId, { paidAmountPaise, reason, actingUser }) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can update paid amount');
        error.status = 403;
        throw error;
    }

    const newPaidAmount = parseInt(paidAmountPaise, 10);
    if (isNaN(newPaidAmount) || newPaidAmount < 0) {
        const error = new Error('Paid amount must be a non-negative integer in paise');
        error.status = 400;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const billRes = await client.query(
            `SELECT id, household_id, user_id, total_amount_paise, paid_amount_paise, status
             FROM bills
             WHERE id = $1
             FOR UPDATE`,
            [billId]
        );

        if (billRes.rows.length === 0) {
            const error = new Error('Bill not found');
            error.status = 404;
            throw error;
        }

        const bill = billRes.rows[0];
        if (bill.household_id !== householdId) {
            const error = new Error('Forbidden: Bill belongs to another household');
            error.status = 403;
            throw error;
        }

        const oldPaidAmount = bill.paid_amount_paise;

        // If setting to 0 or reducing paid amount, revoke previous active payments to maintain consistency
        if (newPaidAmount === 0) {
            await client.query(
                `UPDATE payments
                 SET status = 'REVOKED', updated_at = CURRENT_TIMESTAMP
                 WHERE bill_id = $1 AND status = 'VALID'`,
                [bill.id]
            );
        }

        const updatedRes = await client.query(
            `UPDATE bills
             SET paid_amount_paise = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING id, household_id, user_id, total_amount_paise, paid_amount_paise, status`,
            [newPaidAmount, bill.id]
        );

        const updatedBill = updatedRes.rows[0];

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                newPaidAmount === 0 ? 'MARK_BILL_UNPAID' : 'UPDATE_PAID_AMOUNT',
                'bill',
                String(bill.id),
                reason || (newPaidAmount === 0 ? 'Admin marked bill as unpaid' : `Admin updated paid amount to ${newPaidAmount} paise`),
                JSON.stringify({
                    billId: bill.id,
                    oldPaidAmount,
                    newPaidAmount,
                    totalAmountPaise: updatedBill.total_amount_paise
                })
            ]
        );

        await client.query('COMMIT');

        const balancePaise = Math.max(0, updatedBill.total_amount_paise - updatedBill.paid_amount_paise);
        const paymentStatus = updatedBill.paid_amount_paise >= updatedBill.total_amount_paise && updatedBill.total_amount_paise > 0
            ? 'PAID'
            : (updatedBill.paid_amount_paise > 0 ? 'PARTIAL' : 'PENDING');

        return {
            id: updatedBill.id,
            householdId: updatedBill.household_id,
            userId: updatedBill.user_id,
            totalAmountPaise: updatedBill.total_amount_paise,
            paidAmountPaise: updatedBill.paid_amount_paise,
            balancePaise,
            status: updatedBill.status,
            paymentStatus
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Finalizes a bill (Admin only).
 * State transition: OPEN/REOPENED -> FINALIZED
 */
async function finalizeBill(householdId, billId, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can finalize bills');
        error.status = 403;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const billRes = await client.query(
            `SELECT id, household_id, user_id, status FROM bills WHERE id = $1 FOR UPDATE`,
            [billId]
        );

        if (billRes.rows.length === 0) {
            const error = new Error('Bill not found');
            error.status = 404;
            throw error;
        }

        const bill = billRes.rows[0];
        if (bill.household_id !== householdId) {
            const error = new Error('Forbidden: Bill belongs to another household');
            error.status = 403;
            throw error;
        }

        if (bill.status === 'FINALIZED') {
            await client.query('COMMIT');
            return { id: bill.id, status: 'FINALIZED', message: 'Bill is already finalized' };
        }

        const updateRes = await client.query(
            `UPDATE bills
             SET status = 'FINALIZED', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id, household_id, user_id, billing_month, total_amount_paise, paid_amount_paise, status, updated_at`,
            [bill.id]
        );

        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'FINALIZE_BILL',
                'bill',
                String(bill.id),
                'Bill finalized by administrator',
                JSON.stringify({ billId: bill.id, fromStatus: bill.status, toStatus: 'FINALIZED' })
            ]
        );

        await client.query('COMMIT');
        return updateRes.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Reopens a finalized bill (Admin only, requires non-empty reason).
 */
async function reopenBill(householdId, billId, reason, actingUser) {
    if (actingUser.role !== 'ADMIN') {
        const error = new Error('Forbidden: Only administrators can reopen bills');
        error.status = 403;
        throw error;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        const error = new Error('A non-empty reason is required to reopen a finalized bill');
        error.status = 400;
        throw error;
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const billRes = await client.query(
            `SELECT id, household_id, user_id, status FROM bills WHERE id = $1 FOR UPDATE`,
            [billId]
        );

        if (billRes.rows.length === 0) {
            const error = new Error('Bill not found');
            error.status = 404;
            throw error;
        }

        const bill = billRes.rows[0];
        if (bill.household_id !== householdId) {
            const error = new Error('Forbidden: Bill belongs to another household');
            error.status = 403;
            throw error;
        }

        if (bill.status !== 'FINALIZED') {
            const error = new Error(`Cannot reopen bill with status ${bill.status}. Only FINALIZED bills can be reopened.`);
            error.status = 400;
            throw error;
        }

        const updateRes = await client.query(
            `UPDATE bills
             SET status = 'REOPENED', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING id, household_id, user_id, billing_month, total_amount_paise, paid_amount_paise, status, updated_at`,
            [bill.id]
        );

        await client.query(
            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                actingUser.id,
                'REOPEN_BILL',
                'bill',
                String(bill.id),
                reason.trim(),
                JSON.stringify({ billId: bill.id, fromStatus: 'FINALIZED', toStatus: 'REOPENED', reason: reason.trim() })
            ]
        );

        await client.query('COMMIT');
        return updateRes.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Automatically checks and generates bills for all members whose billing periods have commenced.
 * Safe across restarts, uses transactions with row-level locks, prevents duplicate generation,
 * and preserves payment records and finalized bills.
 */
async function runAutomaticBillingCheck(options = {}) {
    const todayStr = options.todayStr || getKolkataDateParts().dateStr;
    const client = await db.pool.connect();

    try {
        // Fetch all households
        const householdsRes = await client.query('SELECT id, name FROM households ORDER BY id ASC');
        const households = householdsRes.rows;
        const allResults = [];

        for (const hh of households) {
            const householdId = hh.id;
            let generatedCount = 0;
            let preservedCount = 0;
            const logDetails = [];

            try {
                // Fetch household members
                const membersRes = await client.query(
                    `SELECT u.id, u.name, m.role, TO_CHAR(m.mess_start_date, 'YYYY-MM-DD') as mess_start_date
                     FROM household_memberships m
                     JOIN users u ON m.user_id = u.id
                     WHERE m.household_id = $1
                     ORDER BY u.id ASC`,
                    [householdId]
                );
                const members = membersRes.rows;

                for (const member of members) {
                    let periodStart;
                    let periodEnd;
                    let cycleIndex = null;
                    let billingMonth;

                    if (member.mess_start_date) {
                        // Find current billing cycle for member on todayStr
                        const cycle = getCurrentBillingCycle(member.mess_start_date, todayStr);
                        // Do not generate if today is strictly before start date
                        if (todayStr < member.mess_start_date) {
                            continue;
                        }
                        periodStart = cycle.startDate;
                        periodEnd = cycle.endDate;
                        cycleIndex = cycle.cycleIndex;
                        billingMonth = periodStart.substring(0, 7);
                    } else {
                        // Calendar month fallback [YYYY-MM-01, next month)
                        const currentMonthStr = todayStr.substring(0, 7);
                        const { startDate: calStart } = getMonthBoundaries(currentMonthStr);
                        periodStart = calStart;
                        const [y, m] = currentMonthStr.split('-').map(Number);
                        const nextM = m === 12 ? 1 : m + 1;
                        const nextY = m === 12 ? y + 1 : y;
                        periodEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
                        billingMonth = currentMonthStr;
                    }

                    // Attempt generation for this member within a separate transaction
                    const memberClient = await db.pool.connect();
                    try {
                        await memberClient.query('BEGIN');

                        // Check existing bill
                        const existingBillRes = await memberClient.query(
                            `SELECT id, household_id, user_id, billing_month, period_start, period_end,
                                    total_amount_paise, paid_amount_paise, status, snapshot_data
                             FROM bills
                             WHERE household_id = $1 AND user_id = $2 
                               AND ((period_start = $3 AND period_end = $4) OR (billing_month = $5 AND period_start IS NULL))
                             FOR UPDATE`,
                            [householdId, member.id, periodStart, periodEnd, billingMonth]
                        );

                        if (existingBillRes.rows.length > 0) {
                            const existingBill = existingBillRes.rows[0];
                            if (existingBill.status === 'FINALIZED') {
                                preservedCount++;
                                logDetails.push({
                                    userId: member.id,
                                    userName: member.name,
                                    periodStart,
                                    periodEnd,
                                    status: 'PRESERVED_FINALIZED'
                                });
                                await memberClient.query('COMMIT');
                                continue;
                            }
                        }

                        // Calculate daily breakdown
                        const breakdownData = await calculateIntervalBreakdown(
                            householdId,
                            member.id,
                            periodStart,
                            periodEnd,
                            memberClient
                        );

                        const snapshot = {
                            billingMonth,
                            periodStart,
                            periodEnd,
                            cycleIndex,
                            nextBillingDate: periodEnd,
                            messStartDate: member.mess_start_date,
                            totalDays: breakdownData.dailyBreakdown.length,
                            chargeableDays: breakdownData.chargeableDays,
                            cancelledDays: breakdownData.cancelledDays,
                            leaveDays: breakdownData.leaveDays || 0,
                            messUnavailableDays: breakdownData.messUnavailableDays,
                            generatedAt: new Date().toISOString(),
                            generatedBy: 'scheduler',
                            dailyBreakdown: breakdownData.dailyBreakdown
                        };

                        if (existingBillRes.rows.length > 0) {
                            // Update existing OPEN or REOPENED bill without changing payment or status
                            await memberClient.query(
                                `UPDATE bills
                                 SET total_amount_paise = $1,
                                     snapshot_data = $2,
                                     period_start = $3,
                                     period_end = $4,
                                     cycle_index = $5,
                                     updated_at = CURRENT_TIMESTAMP
                                 WHERE id = $6`,
                                [
                                    breakdownData.totalPaise,
                                    JSON.stringify(snapshot),
                                    periodStart,
                                    periodEnd,
                                    cycleIndex,
                                    existingBillRes.rows[0].id
                                ]
                            );
                            preservedCount++;
                            logDetails.push({
                                userId: member.id,
                                userName: member.name,
                                periodStart,
                                periodEnd,
                                status: 'UPDATED_EXISTING',
                                totalPaise: breakdownData.totalPaise
                            });
                        } else {
                            // Insert new bill
                            await memberClient.query(
                                `INSERT INTO bills (household_id, user_id, billing_month, period_start, period_end, cycle_index, total_amount_paise, snapshot_data, status)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN')
                                 ON CONFLICT (household_id, user_id, billing_month)
                                 DO UPDATE SET 
                                    total_amount_paise = EXCLUDED.total_amount_paise,
                                    snapshot_data = EXCLUDED.snapshot_data,
                                    period_start = EXCLUDED.period_start,
                                    period_end = EXCLUDED.period_end,
                                    cycle_index = EXCLUDED.cycle_index,
                                    updated_at = CURRENT_TIMESTAMP
                                 WHERE bills.status != 'FINALIZED'`,
                                [
                                    householdId,
                                    member.id,
                                    billingMonth,
                                    periodStart,
                                    periodEnd,
                                    cycleIndex,
                                    breakdownData.totalPaise,
                                    JSON.stringify(snapshot)
                                ]
                            );
                            generatedCount++;
                            logDetails.push({
                                userId: member.id,
                                userName: member.name,
                                periodStart,
                                periodEnd,
                                status: 'GENERATED_NEW',
                                totalPaise: breakdownData.totalPaise
                            });
                        }

                        // Audit log per member
                        await memberClient.query(
                            `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, details)
                             VALUES ($1, $2, $3, $4, $5, $6)`,
                            [
                                null,
                                'AUTOMATIC_BILL_GENERATION',
                                'bill',
                                `${householdId}_${member.id}_${periodStart}`,
                                `Automatic bill generated for period ${periodStart} to ${periodEnd}`,
                                JSON.stringify({
                                    householdId,
                                    userId: member.id,
                                    periodStart,
                                    periodEnd,
                                    cycleIndex,
                                    totalPaise: breakdownData.totalPaise
                                })
                            ]
                        );

                        await memberClient.query('COMMIT');
                    } catch (memberErr) {
                        await memberClient.query('ROLLBACK');
                        logDetails.push({
                            userId: member.id,
                            userName: member.name,
                            status: 'ERROR',
                            error: memberErr.message
                        });
                    } finally {
                        memberClient.release();
                    }
                }

                // Log execution in billing_automation_logs
                const status = logDetails.some(d => d.status === 'ERROR') ? 'PARTIAL' : 'SUCCESS';
                await client.query(
                    `INSERT INTO billing_automation_logs (household_id, status, generated_count, preserved_count, details)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                        householdId,
                        status,
                        generatedCount,
                        preservedCount,
                        JSON.stringify({ todayStr, details: logDetails })
                    ]
                );

                allResults.push({
                    householdId,
                    status,
                    generatedCount,
                    preservedCount,
                    details: logDetails
                });
            } catch (hhErr) {
                await client.query(
                    `INSERT INTO billing_automation_logs (household_id, status, generated_count, preserved_count, error_message)
                     VALUES ($1, 'FAILED', 0, 0, $2)`,
                    [householdId, hhErr.message]
                );
                allResults.push({
                    householdId,
                    status: 'FAILED',
                    error: hhErr.message
                });
            }
        }

        return allResults;
    } finally {
        client.release();
    }
}

/**
 * Returns latest automation logs and status for a household.
 */
async function getLatestAutomationStatus(householdId) {
    const res = await db.query(
        `SELECT id, household_id, executed_at, status, generated_count, preserved_count, details, error_message
         FROM billing_automation_logs
         WHERE household_id = $1
         ORDER BY executed_at DESC
         LIMIT 10`,
        [householdId]
    );

    return res.rows[0] || null;
}

module.exports = {
    generateMonthlyBills,
    getBills,
    getBillById,
    recordPayment,
    getBillPayments,
    revokePayment,
    updateBillPaidAmount,
    finalizeBill,
    reopenBill,
    getMemberCycleSummary,
    updateMemberMessStartDate,
    runAutomaticBillingCheck,
    getLatestAutomationStatus,
    calculateIntervalBreakdown
};

