export const AI_FEATURES = [
  '训练计划',
  '自动训练计划',
  '体能建议',
  '体能导入识别',
  '个人报告点评',
  '队伍周总结',
] as const;

export const AI_STATES = {
  running: '请求中',
  success: '已结算',
  failed: '失败（已结算）',
  unknown: '待确认',
} as const;

export type AiSettings = { enabled: boolean; budgetYuan: number };

export type AiAttempt = {
  id: number;
  job: string;
  account: number | null;
  username: string | null;
  feature: string;
  started: string;
  provider: string;
  model: string;
  state: keyof typeof AI_STATES;
  reserved: number;
  input: number | null;
  output: number | null;
  cost: number | null;
};

export type AiManagementData = {
  settings: AiSettings;
  today: string;
  summary: {
    requests: number;
    attempts: number;
    input: number;
    output: number;
    settled: number;
    pending: number;
  };
  attempts: AiAttempt[];
  next: number | null;
};
