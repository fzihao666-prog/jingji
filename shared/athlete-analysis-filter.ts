export type AthleteAnalysisSearchable = {
  id: number;
  name: string;
  team: string;
  specialties?: string;
};

function normalized(value: string) {
  return value.replace(/\s+/g, '').toLocaleLowerCase();
}

export function filterAnalysisAthletes<T extends AthleteAnalysisSearchable>(
  athletes: T[],
  query: string
) {
  const keyword = normalized(query.trim());
  if (!keyword) return athletes;
  return athletes.filter((athlete) =>
    [athlete.name, athlete.team, athlete.specialties || '']
      .map(normalized)
      .some((value) => value.includes(keyword))
  );
}
