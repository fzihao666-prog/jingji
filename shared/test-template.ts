import { fmsInputFields, type FmsInputKey } from './fms-import.js';
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
  fields: Array<{ label: string; unit: string; valueKind?: TestTemplateMetricInput['valueKind'] }>;
  protocol?: string;
};

export type TestTemplateGroup = {
  name: string;
  codes: string[];
  common?: boolean;
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

export const TEST_TEMPLATE_IDENTITY_HEADERS = ['运动员编号', '姓名', '所属队伍', '测试日期'] as const;

export function testTemplateInputColumns(metrics: readonly TestTemplateMetric[]) {
  return metrics.flatMap<{ metric: TestTemplateMetric; metricIndex: number; fmsInput?: FmsInputKey; label: string }>((metric, metricIndex) => metric.testType === 'FMS测试'
    ? fmsInputFields(metric.code, `FMS ${metric.label}`).map(field => ({
        metric, metricIndex, fmsInput: field.key, label: field.header,
      }))
    : [{ metric, metricIndex, fmsInput: undefined, label: metric.unit ? `${metric.label}（${metric.unit}）` : metric.label }]);
}

export function testTemplateHeaders(metrics: readonly TestTemplateMetric[]) {
  const labels = testTemplateInputColumns(metrics).map(column => column.label);
  const used = new Set<string>(TEST_TEMPLATE_IDENTITY_HEADERS);
  const columns = labels.map((label, index) => {
    let header = label;
    if (used.has(header) || labels.indexOf(label) !== labels.lastIndexOf(label))
      header = `${label} [${index + 1}]`;
    while (used.has(header)) header += '·';
    used.add(header);
    return header;
  });
  return [...TEST_TEMPLATE_IDENTITY_HEADERS, ...columns];
}
