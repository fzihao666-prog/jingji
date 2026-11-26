export type ProjectNameKind = 'training' | 'test';

export type ProjectNameMapping = {
  kind: ProjectNameKind;
  source: string;
  target: string;
};

export type ProjectNameCatalog = {
  projects: Array<{
    kind: ProjectNameKind;
    name: string;
    recordCount: number;
    sources: string[];
  }>;
  metrics: Array<{
    kind: ProjectNameKind;
    name: string;
    unit: string;
    projectName: string;
    protocol: string;
    version: string;
    recordCount: number;
    sources: string[];
  }>;
  mappings: ProjectNameMapping[];
};
