function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function periodFor(range) {
  const toDate = new Date();
  const fromDate = new Date(toDate);
  if (range === 'day') fromDate.setDate(toDate.getDate());
  else if (range === 'week') fromDate.setDate(toDate.getDate() - 6);
  else fromDate.setDate(toDate.getDate() - 29);
  return { from: toDateString(fromDate), to: toDateString(toDate) };
}

function shortDate(value) {
  if (!value || value.length < 10) return value || '—';
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}

function ageAt(value, targetValue) {
  if (!value) return null;
  const birth = new Date(`${value}T12:00:00`);
  const target = new Date(`${targetValue || toDateString(new Date())}T12:00:00`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(target.getTime())) return null;
  let age = target.getFullYear() - birth.getFullYear();
  const beforeBirthday = target.getMonth() < birth.getMonth()
    || (target.getMonth() === birth.getMonth() && target.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

module.exports = { toDateString, periodFor, shortDate, ageAt };
