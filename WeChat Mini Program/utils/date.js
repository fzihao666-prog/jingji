/** @param {number} value */
function pad(value) {
  return String(value).padStart(2, '0');
}

/** @param {Date} date */
function toDateString(date) {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())}`;
}

function todayBeijing() { return toDateString(new Date()); }

/** @param {'day' | 'week' | 'month'} range */
function periodFor(range) {
  const to = todayBeijing();
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (range === 'day' ? 0 : range === 'week' ? 6 : 29));
  return { from: fromDate.toISOString().slice(0, 10), to };
}

/** @param {string} value */
function shortDate(value) {
  if (!value || value.length < 10) return value || '—';
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}

/** @param {string} value @param {string} [targetValue] */
function ageAt(value, targetValue) {
  if (!value) return null;
  const birth = new Date(`${value}T12:00:00Z`);
  const target = new Date(`${targetValue || todayBeijing()}T12:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(target.getTime())) return null;
  let age = target.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = target.getUTCMonth() < birth.getUTCMonth()
    || (target.getUTCMonth() === birth.getUTCMonth() && target.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

module.exports = { toDateString, todayBeijing, periodFor, shortDate, ageAt };
