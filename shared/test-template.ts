export type TestTemplateMetricInput = {
  label: string;
  unit: string;
  valueKind: 'number' | 'time';
  direction: 'higher_better' | 'lower_better' | 'neutral';
  protocol: string;
};

export type TestTemplateMetric = TestTemplateMetricInput & {
  code: string;
  protocolVersion: string;
  testType: string;
  editable: boolean;
};

export type TestTemplateGroupInput = {
  name: string;
  fields: Array<{ label: string; unit: string }>;
  protocol?: string;
};

export type TestTemplateGroup = {
  name: string;
  codes: string[];
};

export type TestTemplatePreview = {
  catalog: TestTemplateMetric[];
  groups: TestTemplateGroup[];
  codes: string[];
  projectCodes: string[];
  source: 'project' | 'team';
  athleteCount: number;
  canManageProject: boolean;
};
