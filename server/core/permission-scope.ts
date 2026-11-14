export function allowsTeam(
  permissions: { projects: string[]; teams: Array<{ project: string; team: string }> },
  project: string,
  team: string
) {
  return (
    (permissions.projects.includes('*') || permissions.projects.includes(project)) &&
    permissions.teams.some(
      (item) =>
        (item.project === '*' || item.project === project) &&
        (item.team === '*' || item.team === team)
    )
  );
}
