function formatAthleteNumber(id) {
  return `ATL-${String(id).padStart(6, '0')}`;
}

function matchesAthleteNumber(id, query) {
  const normalized = query.trim().toUpperCase();
  return normalized === String(id) || normalized === formatAthleteNumber(id);
}

module.exports = { formatAthleteNumber, matchesAthleteNumber };
