export type ProjectNameKind = 'training' | 'test';

export type ProjectNameMapping = {
  kind: ProjectNameKind;
  source: string;
  target: string;
};

export type ProjectCatalogField = {
  source: string;
  name: string;
  unit: string;
  protocol: string;
  version: string;
};

export type ProjectCatalogSettings = {
  kind: ProjectNameKind;
  name: string;
  fields: ProjectCatalogField[];
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
  settings: ProjectCatalogSettings[];
};
