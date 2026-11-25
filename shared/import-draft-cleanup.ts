export const IMPORT_DRAFT_RETENTION_DAYS = 30;
export const IMPORT_DRAFT_CLEANUP_LIMIT = 200;

export type ExpiredImportDraft = {
  id: string;
  filename: string;
  createdAt: string;
  itemCount: number;
  revision: number;
};
export type ImportDraftCleanupPreview = {
  retentionDays: number;
  drafts: ExpiredImportDraft[];
};
