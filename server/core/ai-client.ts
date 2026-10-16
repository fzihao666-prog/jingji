// 统一的 OpenAI 兼容模型调用封装：多供应商 fallback 链与 JSON 清洗。
// 体能导入识别与训练计划生成共用此客户端，不再各自维护模型配置。
export type AiModelConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
};

export function configuredModels(): AiModelConfig[] {
  const timeoutValue = Number(process.env.AI_TIMEOUT_MS);
  const timeout = Number.isFinite(timeoutValue) && timeoutValue >= 30_000 ? timeoutValue : 180_000;
  const candidates = [
    ['Primary', process.env.AI_BASE_URL, process.env.AI_API_KEY, process.env.AI_MODEL],
    [
      'Fallback',
      process.env.AI_FALLBACK_BASE_URL,
      process.env.AI_FALLBACK_API_KEY,
      process.env.AI_FALLBACK_MODEL,
    ],
    ['Qwen', process.env.AI_CN_BASE_URL, process.env.AI_CN_API_KEY, process.env.AI_CN_MODEL],
    [
      'Gemini',
      process.env.AI_GEMINI_BASE_URL,
      process.env.AI_GEMINI_API_KEY,
      process.env.AI_GEMINI_MODEL,
    ],
  ] as const;
  return candidates.flatMap(([name, baseUrl, apiKey, model]) =>
    baseUrl && apiKey && model
      ? [
          {
            name,
            baseUrl: baseUrl.replace(/\/+$/, ''),
            apiKey,
            model,
            timeout,
          },
        ]
      : []
  );
}

export function cleanJson(content: string) {
  return content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

export type AiChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'user'; content: unknown[] };

export type AiChatOptions = {
  messages: AiChatMessage[];
  temperature?: number;
  maxCompletionTokens?: number;
  responseFormat?: 'json_object' | 'text';
  // 图片/PDF 等附件不走纯文本消息时由调用方整体替换 user content。
};

export type AiChatResult = { content: string; modelUsed: string };

// 逐个供应商调用直至成功；全部失败时抛出最后的错误。不做静默回退伪造结果。
export async function chatCompletion(options: AiChatOptions): Promise<AiChatResult> {
  const models = configuredModels();
  if (!models.length) throw new Error('当前环境未配置可用的AI模型。');
  let lastError: Error | null = null;
  for (const model of models) {
    try {
      const endpoint = model.baseUrl.endsWith('/chat/completions')
        ? model.baseUrl
        : `${model.baseUrl}/chat/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify({
          model: model.model,
          temperature: options.temperature ?? 0,
          max_completion_tokens: options.maxCompletionTokens ?? 12_000,
          ...(options.responseFormat === undefined || options.responseFormat === 'json_object'
            ? { response_format: { type: 'json_object' } }
            : {}),
          ...(model.model.toLowerCase().startsWith('qwen') ? { enable_thinking: false } : {}),
          messages: options.messages,
        }),
        signal: AbortSignal.timeout(model.timeout),
      });
      if (!response.ok) throw new Error(`AI接口返回 ${response.status}`);
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (payload.error?.message) throw new Error(payload.error.message);
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI接口返回空内容');
      return { content, modelUsed: `${model.name} (${model.model})` };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('未知AI错误');
    }
  }
  throw lastError || new Error('AI调用失败');
}

// 纯文本 JSON 对话：解析失败抛错，由调用方决定是否保留上一版草稿。
export async function chatJson<T>(options: AiChatOptions): Promise<{ data: T; modelUsed: string }> {
  const result = await chatCompletion(options);
  return { data: JSON.parse(cleanJson(result.content)) as T, modelUsed: result.modelUsed };
}
