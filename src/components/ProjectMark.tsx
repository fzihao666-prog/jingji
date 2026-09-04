type ProjectMarkProps = {
  project: string;
  className?: string;
};

function DefaultProjectMark({ project, className = '' }: ProjectMarkProps) {
  return (
    <svg className={`project-mark project-mark-unknown ${className}`.trim()} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="20" fill="currentColor" opacity="0.12" />
      <text x="24" y="28" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="800">{project.slice(0, 1)}</text>
    </svg>
  );
}

export function ProjectMark({ project, className = '' }: ProjectMarkProps) {
  const sourceByProject: Record<string, string> = {
    赛艇: '/assets/olympic-sports/rowing.gif',
    皮划艇: '/assets/olympic-sports/canoe sprint.gif',
    激流: '/assets/olympic-sports/canoe slalom.gif',
  };
  const source = sourceByProject[project];

  if (source) {
    return (
      <span className={`project-mark ${className}`.trim()}>
        <img
          src={source}
          alt=""
          aria-hidden="true"
        />
      </span>
    );
  } 
  return <DefaultProjectMark project={project} className={className} />;
}
