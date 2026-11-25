function formatAthleteNumber(id) {
  return `ATL${String(id).padStart(5, '0')}`;
}

function parseAthleteNumber(input) {
  const match = /^(?:ATL-?)?(\d+)$/i.exec(input.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function matchesAthleteNumber(id, query) {
  return parseAthleteNumber(query) === id;
}

module.exports = { formatAthleteNumber, matchesAthleteNumber };
