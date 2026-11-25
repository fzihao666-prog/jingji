export type DeepSeekReasoningEffort = 'none' | 'low' | 'high' | 'max';

export function deepseekReasoningOptions(
  baseUrl: string,
  effort: string | undefined
): { reasoning_effort?: DeepSeekReasoningEffort } {
  const value = effort?.trim();
  // 此配置只用于 DeepSeek 官方主模型，不向其他兼容供应商传递专属参数。
  if (!value || !URL.canParse(baseUrl) || new URL(baseUrl).hostname !== 'api.deepseek.com') {
    return {};
  }
  if (value !== 'none' && value !== 'low' && value !== 'high' && value !== 'max') {
    throw new Error('AI_REASONING_EFFORT 仅支持 none、low、high、max。');
  }
  return { reasoning_effort: value };
}
