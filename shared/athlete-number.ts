export function formatAthleteNumber(id: number): string {
  return `ATL${String(id).padStart(5, '0')}`;
}

export function parseAthleteNumber(input: string): number | null {
  const match = /^(?:ATL-?)?(\d+)$/i.exec(input.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function matchesAthleteNumber(id: number, query: string): boolean {
  return parseAthleteNumber(query) === id;
}
