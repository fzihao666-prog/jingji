export function formatAthleteNumber(id: number): string {
  return `ATL-${String(id).padStart(6, '0')}`;
}

export function matchesAthleteNumber(id: number, query: string): boolean {
  const normalized = query.trim().toUpperCase();
  return normalized === String(id) || normalized === formatAthleteNumber(id);
}
