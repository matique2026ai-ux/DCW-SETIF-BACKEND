// Algeria Timezone Configuration (Africa/Algiers - UTC+1)
process.env.TZ = 'Africa/Algiers';

const ALGERIA_TZ = 'Africa/Algiers';

/**
 * Returns today's date formatted as YYYY-MM-DD in Africa/Algiers timezone
 */
function getTodayAlgeria() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ALGERIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

/**
 * Returns current timestamp adjusted to Algeria time (UTC+1)
 */
function getNowAlgeriaDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 1));
}

/**
 * Returns current timestamp as ISO string in Algeria local time
 */
function getNowAlgeriaIso() {
  return getNowAlgeriaDate().toISOString();
}

module.exports = {
  ALGERIA_TZ,
  getTodayAlgeria,
  getNowAlgeriaDate,
  getNowAlgeriaIso,
};
