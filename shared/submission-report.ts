import type { Project } from './projects.ts';

export type SubmissionReport = {
  teams: { project: Project; name: string; coaches: number[]; athletes: number }[];
  coaches: { id: number; name: string; roles: string[] }[];
  records: [team: number, type: number, date: string, reference: string, athleteId?: number][];
  types: string[];
};

export type BasicSubmissionReport = {
  asOf: string;
  sheets: { name: string; rows: (string | number)[][] }[];
};
