export const UNASSIGNED_SUBMISSION_ROLE = '待确认';

export type SubmissionSummary = {
  key: string;
  team: string;
  projects?: string[];
  lastSubmitted?: string;
  role: string;
  name: string;
  group: boolean;
  direct: number;
  delegated: number;
  unknown: number;
  total: number;
  types: Record<string, number>;
};

export type SubmissionDetail = {
  project?: string;
  id: string;
  key: string;
  groupKey: string;
  team: string;
  role: string;
  name: string;
  type: string;
  athlete: string;
  businessDate: string;
  submittedDate: string;
  operator: string;
  basis: string;
};

export type SubmissionReport = {
  rows: SubmissionSummary[];
  total: number;
  types: Record<string, number>;
  details: SubmissionDetail[];
  detailTotal: number;
  teams: string[];
};
