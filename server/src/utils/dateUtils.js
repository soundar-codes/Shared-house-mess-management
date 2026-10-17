function getKolkataDateParts(date = new Date()) {
    const kolkataMs = date.getTime() + 19800000; // +5:30
    const kDate = new Date(kolkataMs);
    
    const year = kDate.getUTCFullYear();
    const month = String(kDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kDate.getUTCDate()).padStart(2, '0');
    
    const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayOfWeekNames[kDate.getUTCDay()];

    return {
        year,
        month,
        day,
        dayOfWeek,
        hour: kDate.getUTCHours(),
        minute: kDate.getUTCMinutes(),
        second: kDate.getUTCSeconds(),
        ms: kDate.getUTCMilliseconds(),
        dateStr: `${year}-${month}-${day}`
    };
}

function getTomorrowDateStr(date = new Date()) {
    const kolkataMs = date.getTime() + 19800000;
    const tomorrowDate = new Date(kolkataMs);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    
    const year = tomorrowDate.getUTCFullYear();
    const month = String(tomorrowDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(tomorrowDate.getUTCDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

function isFoodUpdateAllowed(targetDateStr, now = new Date(), cutoffTimeStr = '23:00') {
    const kParts = getKolkataDateParts(now);
    const tomorrowStr = getTomorrowDateStr(now);
    
    if (targetDateStr !== tomorrowStr) {
        return false; // Only tomorrow is allowed
    }
    
    const [cutoffHour, cutoffMinute] = (cutoffTimeStr || '23:00').split(':').map(Number);
    const currentTotalMinutes = kParts.hour * 60 + kParts.minute;
    const cutoffTotalMinutes = cutoffHour * 60 + (cutoffMinute || 0);

    // Reject if current time is at or past cutoff
    if (currentTotalMinutes >= cutoffTotalMinutes) {
        return false;
    }
    
    return true;
}

function getMonthBoundaries(yearMonthStr) {
    // yearMonthStr like '2026-10'
    const [yearStr, monthStr] = yearMonthStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10); // 1-indexed
    
    // Start date is simply YYYY-MM-01
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    
    // End date calculation
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const daysInMonth = [31, (isLeap ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const lastDay = daysInMonth[month - 1];
    
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    return { startDate, endDate };
}

function getDaysInMonth(year, month) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    return [31, (isLeap ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * Calculates a member's custom monthly billing cycle for a given cycle index.
 * Cycle 0 starts at anchorDateStr (e.g. '2026-10-10').
 * Next cycle begins exactly on the previous cycle's end date (start-inclusive, end-exclusive).
 * Preserves anchor day of month, capping at the target month's maximum days (handles leap years and month ends).
 */
function calculateBillingCycle(anchorDateStr, cycleIndex = 0) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDateStr)) {
        throw new Error('Invalid anchor date format. Must be YYYY-MM-DD');
    }
    const [origY, origM, origD] = anchorDateStr.split('-').map(Number);

    function getCycleDate(n) {
        const totalMonths = (origY * 12 + (origM - 1)) + n;
        const y = Math.floor(totalMonths / 12);
        const m = (totalMonths % 12) + 1;
        const maxD = getDaysInMonth(y, m);
        const d = Math.min(origD, maxD);
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    const startDate = getCycleDate(cycleIndex);
    const endDate = getCycleDate(cycleIndex + 1);
    const nextBillingDate = endDate;

    return {
        startDate,
        endDate,
        nextBillingDate,
        cycleIndex
    };
}

/**
 * Finds the billing cycle for a member given an anchor start date and target date (defaults to current Kolkata date).
 */
function getCurrentBillingCycle(anchorDateStr, targetDateStr = getKolkataDateParts().dateStr) {
    if (!anchorDateStr) return null;
    const [anchorY, anchorM] = anchorDateStr.split('-').map(Number);
    const [tY, tM] = targetDateStr.split('-').map(Number);

    let approx = (tY - anchorY) * 12 + (tM - anchorM);
    while (calculateBillingCycle(anchorDateStr, approx).startDate > targetDateStr) {
        approx--;
    }
    while (calculateBillingCycle(anchorDateStr, approx).endDate <= targetDateStr) {
        approx++;
    }
    return calculateBillingCycle(anchorDateStr, approx);
}

/**
 * Generates an array of date strings ['YYYY-MM-DD'] in [startDate, endDate) - start inclusive, end exclusive.
 */
function getDatesInInterval(startDate, endDate) {
    const dates = [];
    let cur = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    while (cur < end) {
        dates.push(cur.toISOString().split('T')[0]);
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

module.exports = {
    getKolkataDateParts,
    getTomorrowDateStr,
    isFoodUpdateAllowed,
    getMonthBoundaries,
    getDaysInMonth,
    calculateBillingCycle,
    getCurrentBillingCycle,
    getDatesInInterval
};

