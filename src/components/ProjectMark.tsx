import { useId } from 'react';

type ProjectMarkProps = {
  project: string;
  className?: string;
};

export function ProjectMark({ project, className = '' }: ProjectMarkProps) {
  const maskId = `project-mark-${useId().replace(/:/g, '')}`;
  const classes = `project-mark ${className}`.trim();

  if (project === '赛艇') {
    return (
      <svg className={classes} viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect width="48" height="48" fill="white" />
            <ellipse cx="24" cy="15" rx="2.3" ry="3.1" fill="black" />
            <ellipse cx="24" cy="24" rx="2.3" ry="3.1" fill="black" />
            <ellipse cx="24" cy="33" rx="2.3" ry="3.1" fill="black" />
          </mask>
        </defs>
        <path className="pictogram-lane" d="M4 5v38M44 5v38" />
        <path className="pictogram-lane pictogram-lane-dash" d="M14 6v36M34 6v36" />
        <path className="pictogram-shell" mask={`url(#${maskId})`} d="M24 2.5c2.4 5 3.2 12 3.1 21.5S26.1 41 24 45.5C21.9 41 21 33.5 20.9 24S21.6 7.5 24 2.5Z" />
        <g className="pictogram-oar">
          <path d="M22 14 8.5 23M26 14l13.5 9M22 23 8.5 32M26 23l13.5 9M22 32 8.5 41M26 32l13.5 9" />
          <path d="M20.5 14h7M20.5 23h7M20.5 32h7" />
        </g>
        <g className="pictogram-blade">
          <rect x="5.7" y="21.8" width="6" height="2.7" rx="1.2" transform="rotate(-34 8.7 23.15)" />
          <rect x="36.3" y="21.8" width="6" height="2.7" rx="1.2" transform="rotate(34 39.3 23.15)" />
          <rect x="5.7" y="30.8" width="6" height="2.7" rx="1.2" transform="rotate(-34 8.7 32.15)" />
          <rect x="36.3" y="30.8" width="6" height="2.7" rx="1.2" transform="rotate(34 39.3 32.15)" />
          <rect x="5.7" y="39.8" width="6" height="2.7" rx="1.2" transform="rotate(-34 8.7 41.15)" />
          <rect x="36.3" y="39.8" width="6" height="2.7" rx="1.2" transform="rotate(34 39.3 41.15)" />
        </g>
        <g className="pictogram-rower">
          <circle cx="24" cy="12" r="1.5" /><circle cx="24" cy="21" r="1.5" /><circle cx="24" cy="30" r="1.5" />
        </g>
      </svg>
    );
  }

  if (project === '皮划艇') {
    return (
      <svg className={classes} viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect width="48" height="48" fill="white" />
            <ellipse cx="24" cy="24" rx="3" ry="5" fill="black" />
          </mask>
        </defs>
        <path className="pictogram-lane" d="M5 5v38M43 5v38" />
        <path className="pictogram-lane pictogram-lane-dash" d="M14 6v36M34 6v36" />
        <path className="pictogram-shell" mask={`url(#${maskId})`} d="M24 3c3 5.8 4.3 13.4 4 21-.3 8.4-1.7 16-4 21-2.3-5-3.7-12.6-4-21-.3-7.6 1-15.2 4-21Z" />
        <path className="pictogram-oar" d="M10 24h28" />
        <path className="pictogram-blade" d="M10.5 21.5H6.7c-2.1 0-3.7 1.1-3.7 2.5s1.6 2.5 3.7 2.5h3.8c1 0 1.8-.8 1.8-1.8v-1.4c0-1-.8-1.8-1.8-1.8ZM37.5 21.5h3.8c2.1 0 3.7 1.1 3.7 2.5s-1.6 2.5-3.7 2.5h-3.8c-1 0-1.8-.8-1.8-1.8v-1.4c0-1 .8-1.8 1.8-1.8Z" />
      </svg>
    );
  }

  return (
    <svg className={classes} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <mask id={maskId}>
          <rect width="48" height="48" fill="white" />
          <ellipse cx="26" cy="25" rx="3.2" ry="5" transform="rotate(45 26 25)" fill="black" />
        </mask>
      </defs>
      <g className="pictogram-waves">
        <path d="M4 13c3-3 6-3 9 0M3 20c3-3 6-3 9 0M5 28c3-3 6-3 9 0M4 37c3-3 6-3 9 0" />
        <path d="M13 9c3 3 6 3 9 0M14 16c3 3 6 3 9 0M31 9c3-3 6-3 9 0M34 16c3-3 6-3 9 0M34 34c3-3 6-3 9 0M30 42c3-3 6-3 9 0" />
        <path d="M10 44c3-3 6-3 9 0M16 38c3 3 6 3 9 0M36 27c3-3 6-3 9 0" />
      </g>
      <path className="pictogram-shell" mask={`url(#${maskId})`} d="M10 39C16 29 28 16 40 8c-5 10-17 23-30 31Z" />
      <path className="pictogram-oar" d="M26 25 39 38" />
      <path className="pictogram-blade" d="M37 36.2c1.3-1.3 3.6-.8 5.2 1.1l2 2.4-4.1 4.1-2.4-2c-1.9-1.6-2.4-3.9-1.1-5.2l.4-.4Z" />
      <path className="pictogram-gate" d="M8 4v13M42 29v15" />
    </svg>
  );
}
