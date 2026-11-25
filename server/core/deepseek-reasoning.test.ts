import { describe, expect, it } from 'vitest';
import { deepseekReasoningOptions } from './deepseek-reasoning.ts';

describe('DeepSeek 推理强度配置', () => {
  it.each(['none', 'low', 'high', 'max'] as const)('官方接口传递 %s', (effort) => {
    expect(deepseekReasoningOptions('https://api.deepseek.com/v1', effort)).toEqual({
      reasoning_effort: effort,
    });
  });
  it.each([undefined, '', '   '])('未配置时保留供应商默认行为：%s', (effort) => {
    expect(deepseekReasoningOptions('https://api.deepseek.com', effort)).toEqual({});
  });
  it('去除配置值周围空白', () => {
    expect(deepseekReasoningOptions('https://api.deepseek.com', ' high ')).toEqual({
      reasoning_effort: 'high',
    });
  });
  it('错误配置明确报错，不回显配置内容', () => {
    expect(() => deepseekReasoningOptions('https://api.deepseek.com', 'invalid-value')).toThrow(
      'AI_REASONING_EFFORT 仅支持 none、low、high、max。'
    );
  });
  it.each([
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://api.deepseek.com.example.invalid',
  ])('其他供应商不接收主模型推理强度：%s', (baseUrl) => {
    expect(deepseekReasoningOptions(baseUrl, 'high')).toEqual({});
  });
});
