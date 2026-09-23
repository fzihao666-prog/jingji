const PERSONAL_FIELDS = [
  'name', 'gender', 'birthDate', 'identityNumber', 'ethnicity', 'phone', 'bloodType',
  'emergencyContact', 'emergencyPhone', 'education', 'technicalLevel', 'athletePosition',
  'healthStatus', 'bestResult', 'nativePlace', 'homeAddress', 'athleteStatus',
  'startSportDate', 'trainingVenue', 'currentEvent', 'trainingPhase', 'campPeriod',
  'originPlace', 'originUnit', 'originCoach', 'specialties', 'notes'
];

function normalizeDate(value, label) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const message = `${label}须为有效日期，格式为 YYYY-MM-DD。`;
  if (!match) throw new Error(message);
  const normalized = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error(message);
  }
  return normalized;
}

function personalProfilePayload(form) {
  const payload = {};
  PERSONAL_FIELDS.forEach((field) => {
    const value = form[field];
    payload[field] = value === null || value === undefined ? '' : String(value).trim();
  });
  if (payload.name.length < 2 || payload.name.length > 20) {
    throw new Error('姓名须为2—20个字符。');
  }
  if (/[\r\n\t<>]/.test(payload.name)) throw new Error('姓名包含无效字符。');
  payload.birthDate = normalizeDate(payload.birthDate, '出生日期');
  payload.startSportDate = normalizeDate(payload.startSportDate, '开始运动日期');
  return payload;
}

module.exports = { personalProfilePayload };
