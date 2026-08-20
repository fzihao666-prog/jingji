import type { Project } from '../types';

type Props = {
  project: Project;
};

export function ProjectMark({ project }: Props) {
  if (project === '赛艇') {
    return (
      <svg className="project-mark" viewBox="0 0 36 26" aria-hidden="true">
        <path d="M4 13c4.4-2.2 9.1-3.3 14-3.3S27.6 10.8 32 13c-4.4 2.2-9.1 3.3-14 3.3S8.4 15.2 4 13Z" />
        <path d="M9 4.5 15.5 13 8.3 22M27 4.5 20.5 13l7.2 9" />
        <path d="M5.8 3.6 10 6.1M30.2 3.6 26 6.1M5 22.2l4.3-2.4M31 22.2l-4.3-2.4" />
        <path d="M14 11.2v3.6M18 10.2v5.6M22 11.2v3.6" />
      </svg>
    );
  }

  if (project === '皮划艇') {
    return (
      <svg className="project-mark" viewBox="0 0 36 26" aria-hidden="true">
        <path d="M4 15.2c4 1.1 8.7 1.7 14 1.7s10-.6 14-1.7c-2.2 4-7.2 6.3-14 6.3S6.2 19.2 4 15.2Z" />
        <path d="m8.2 4.5 19.6 16.8" />
        <path d="m5.2 2.4 5.3 1.9-2.3 2.8-3-4.7ZM30.8 23.6l-5.3-1.9 2.3-2.8 3 4.7Z" />
        <path d="M13.8 15.9c.7-2.4 2.1-3.6 4.2-3.6s3.5 1.2 4.2 3.6" />
      </svg>
    );
  }

  return (
    <svg className="project-mark" viewBox="0 0 36 26" aria-hidden="true">
      <path d="M10 3.2v12.4M26 3.2v12.4M8.2 3.2h3.6M24.2 3.2h3.6" />
      <path d="M3 19c2.3-2.6 4.7-2.6 7 0s4.7 2.6 7 0 4.7-2.6 7 0 4.7 2.6 9 0" />
      <path d="m14 11.2 4 3.2 4-3.2M18 14.4v5.2" />
      <path d="M14.5 22.1h7" />
    </svg>
  );
}
