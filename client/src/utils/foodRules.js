export function getKolkataDateString(nowDate = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(nowDate); // YYYY-MM-DD
}

export function getKolkataTimeString(nowDate = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return formatter.format(nowDate); // HH:mm:ss
}

export function getNextDayString(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(Date.UTC(y, parseInt(m)-1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().split('T')[0];
}

export function canChangeFood(targetDateStr, nowDate = new Date()) {
  return getFoodActionState(targetDateStr, nowDate).allowed;
}

export function getTomorrowCutoff(_nowDate = new Date()) {
  return '23:00:00';
}

export function getFoodActionState(targetDateStr, nowDate = new Date()) {
  const todayStr = getKolkataDateString(nowDate);
  const timeStr = getKolkataTimeString(nowDate);
  const tomorrowStr = getNextDayString(todayStr);

  if (targetDateStr < todayStr) {
    return { allowed: false, reason: 'PAST_DATE' };
  }
  if (targetDateStr === todayStr) {
    return { allowed: false, reason: 'TODAY' };
  }
  if (targetDateStr === tomorrowStr) {
    if (timeStr >= getTomorrowCutoff(nowDate)) {
      return { allowed: false, reason: 'CUTOFF_PASSED' };
    }
    return { allowed: true, reason: 'ALLOWED' };
  }
  if (targetDateStr > tomorrowStr) {
    return { allowed: false, reason: 'FUTURE_DATE' };
  }
  return { allowed: false, reason: 'UNKNOWN' };
}
