import type { Project } from './projects.ts';

export type SubmissionReport = {
  teams: { project: Project; name: string; coaches: number[] }[];
  coaches: { id: number; name: string; roles: string[] }[];
  records: [team: number, type: number, date: string, reference: string][];
  types: string[];
};
