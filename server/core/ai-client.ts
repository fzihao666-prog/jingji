import { z } from 'zod';
import { AiGuardError, aiJob, currentAiLedger, withAiLedger } from './ai-usage.ts';
import { deepseekReasoningOptions, type DeepSeekReasoningEffort } from './deepseek-reasoning.ts';

// 统一的 OpenAI 兼容模型调用封装：多供应商 fallback 链与 JSON 清洗。
// 体能导入识别与训练计划生成共用此客户端，不再各自维护模型配置。
export type AiModelConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
  reasoningEffort?: DeepSeekReasoningEffort;
};

export function configuredModels(): AiModelConfig[] {
  const timeoutValue = Number(process.env.AI_TIMEOUT_MS);
  const timeout =
    Number.isFinite(timeoutValue) && timeoutValue >= 30_000 && timeoutValue <= 600_000
      ? timeoutValue
      : 180_000;
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
            reasoningEffort: deepseekReasoningOptions(
              baseUrl,
              name === 'Primary' ? process.env.AI_REASONING_EFFORT : undefined
            ).reasoning_effort,
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
  { role: 'system' | 'user' | 'assistant'; content: string } | { role: 'user'; content: unknown[] };

export type AiChatOptions = {
  messages: AiChatMessage[];
  temperature?: number;
  maxCompletionTokens?: number;
  completionLimitField?: 'max_completion_tokens';
  responseFormat?: 'json_object' | 'text';
  signal?: AbortSignal;
  // 图片/PDF 等附件不走纯文本消息时由调用方整体替换 user content。
};

export type AiChatResult = { content: string; modelUsed: string };

const pricingKeys: Record<string, string> = {
  Primary: 'AI_PRICING',
  Fallback: 'AI_FALLBACK_PRICING',
  Qwen: 'AI_CN_PRICING',
  Gemini: 'AI_GEMINI_PRICING',
};

function readPricing(model: AiModelConfig) {
  const key = pricingKeys[model.name];
  const parts = (process.env[key] ?? '').split(',');
  const [context, input, output, cached = input] = parts.map(Number);
  if (
    parts.length < 3 ||
    parts.length > 4 ||
    parts.some((value) => !value.trim()) ||
    !Number.isSafeInteger(context) ||
    context <= 0 ||
    ![input, output, cached].every((value) => Number.isFinite(value) && value > 0) ||
    cached > input
  )
    throw new AiGuardError(`AI 模型 ${model.name} 未配置有效计费上界。`);
  return { context, input, output, cached };
}

const tokenCount = z.number().int().nonnegative();
const usageSchema = z.object({
  prompt_tokens: tokenCount,
  completion_tokens: tokenCount,
  prompt_cache_hit_tokens: tokenCount.optional(),
});
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }).optional(),
      })
    )
    .optional(),
  usage: z.unknown().optional(),
});

function readUsage(value: unknown, price: ReturnType<typeof readPricing>) {
  const parsed = usageSchema.safeParse(value);
  if (!parsed.success) return;
  const {
    prompt_tokens: input,
    completion_tokens: output,
    prompt_cache_hit_tokens: hits = 0,
  } = parsed.data;
  const cached = hits <= input ? hits : 0;
  const cost = Math.ceil(
    (input - cached) * price.input + cached * price.cached + output * price.output
  );
  if (Number.isSafeInteger(cost)) return { input, output, cost };
}

export async function chatCompletion(
  options: AiChatOptions,
  models = configuredModels()
): Promise<AiChatResult> {
  if (!models.length) throw new Error('当前环境未配置可用的AI模型。');
  options.signal?.throwIfAborted();
  const job = aiJob.getStore();
  if (!job) throw new AiGuardError('AI 请求缺少调用者信息。');
  const ledger = currentAiLedger();
  const outputLimit = options.maxCompletionTokens ?? 12_000;
  let lastError: Error | undefined;
  let started = false;
  try {
    for (const model of models) {
      options.signal?.throwIfAborted();
      const price = readPricing(model);
      // 按完整模型上下文预占，涵盖供应商侧格式开销、图片及 PDF。
      const amount = Math.ceil(price.context * price.input + outputLimit * price.output);
      if (!Number.isSafeInteger(amount)) throw new AiGuardError('AI 模型计费上界无效。');
      const endpoint = model.baseUrl.endsWith('/chat/completions')
        ? model.baseUrl
        : `${model.baseUrl}/chat/completions`;
      const body = JSON.stringify({
        model: model.model,
        ...(model.reasoningEffort ? { reasoning_effort: model.reasoningEffort } : {}),
        temperature: options.temperature ?? 0,
        [options.completionLimitField ?? 'max_tokens']: outputLimit,
        ...(options.responseFormat === undefined || options.responseFormat === 'json_object'
          ? { response_format: { type: 'json_object' } }
          : {}),
        ...(model.model.toLowerCase().startsWith('qwen') ? { enable_thinking: false } : {}),
        messages: options.messages,
      });
      options.signal?.throwIfAborted();
      const id = withAiLedger(() =>
        ledger.reserve(
          job,
          { ...model, provider: new URL(endpoint).hostname },
          amount,
          model.timeout
        )
      );
      started = true;
      const timeout = AbortSignal.timeout(model.timeout);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${model.apiKey}`,
          },
          body,
          signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        });
      } catch {
        withAiLedger(() => ledger.finish(id, 'unknown'));
        throw new AiGuardError('AI 调用结果未确认，未自动重试。');
      }
      if (!response.ok) {
        // 上游未返回用量，保留占用。仅明确拒绝的请求允许切换备用。
        withAiLedger(() => ledger.finish(id, 'unknown'));
        await response.body?.cancel().catch(() => {});
        if (![400, 401, 402, 403, 404, 413, 422, 429].includes(response.status))
          throw new AiGuardError('AI 调用结果未确认，未自动重试。');
        lastError = new Error(`AI接口返回 ${response.status}`);
        continue;
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        withAiLedger(() => ledger.finish(id, 'unknown'));
        throw new AiGuardError('AI 调用结果未确认，未自动重试。');
      }
      const parsed = responseSchema.safeParse(payload);
      const usage = readUsage(parsed.success ? parsed.data.usage : undefined, price);
      const content = parsed.success ? parsed.data.choices?.[0]?.message?.content : undefined;
      withAiLedger(() =>
        ledger.finish(id, usage ? (content ? 'success' : 'failed') : 'unknown', usage)
      );
      if (content) return { content, modelUsed: `${model.name} (${model.model})` };
      if (!usage) throw new AiGuardError('AI 调用用量未确认，未自动重试。');
      lastError = new Error('AI接口返回空内容');
    }
    throw lastError || new Error('AI调用失败');
  } finally {
    if (started) withAiLedger(() => ledger.release(job));
  }
}

// 纯文本 JSON 对话：解析失败抛错，由调用方决定是否保留上一版草稿。
export async function chatJson<T>(options: AiChatOptions): Promise<{ data: T; modelUsed: string }> {
  const result = await chatCompletion(options);
  return { data: JSON.parse(cleanJson(result.content)) as T, modelUsed: result.modelUsed };
}
