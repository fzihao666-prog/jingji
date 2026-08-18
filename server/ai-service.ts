/**
 * AI 服务 - 支持多模型训练计划生成
 * 支持模型：OpenAI GPT-4、Claude、Gemini、文心一言、通义千问等
 */

import { randomUUID } from 'node:crypto';

// 模型配置接口
interface AIModelConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
}

// 运动员上下文
interface AthleteContext {
  athlete: {
    id: number;
    name: string;
    project: string;
    team: string;
    gender: string;
    region?: string;
  };
  recentPlans: RecentPlan[];
  recentRecords: RecentRecord[];
  strengthTests: StrengthTest[];
}

interface RecentPlan {
  date: string;
  duration: number;
  title: string;
  exercises: string[];
  maxWeights: Record<string, number>;
}

interface RecentRecord {
  date: string;
  trainingType: string;
  durationMin: number;
  rpe: number | null;
  fatigueIndex: number | null;
  status: string;
}

interface StrengthTest {
  date: string;
  metrics: Record<string, number>;
}

// 动态训练计划数据结构
interface DynamicTrainingPlan {
  title: string;
  summary: string;
  durationWeeks: number;
  startDate: string;
  endDate: string;
  scheduleLabel: string;
  bodyWeight: number | null;
  age: number | null;
  weeklyPlans: WeeklyPlan[];
  exercises: PlanExercise[];
  aiModel: string;
}

interface WeeklyPlan {
  weekNumber: number;
  focus: string;
  totalLoad: number;
  days: TrainingDay[];
}

interface TrainingDay {
  dayOfWeek: string;
  exercises: DayExercise[];
}

interface DayExercise {
  name: string;
  sets: string;
  reps: string;
  percentage: number;
  plannedWeight?: number;
  notes?: string;
}

interface PlanExercise {
  id: string;
  name: string;
  maxWeight: number | null;
  unitNote: string;
}

// AI 生成结果
interface AIGenerationResult {
  plan: DynamicTrainingPlan;
  modelUsed: string;
  attempts: number;
}

export class TrainingPlanAIService {
  private models: AIModelConfig[];

  constructor() {
    this.models = this.loadModelConfigs();
  }

  /**
   * 加载模型配置（从环境变量）
   */
  private loadModelConfigs(): AIModelConfig[] {
    const models: AIModelConfig[] = [];

    // 主模型（优先级最高）
    if (process.env.AI_API_KEY && process.env.AI_BASE_URL && process.env.AI_MODEL) {
      models.push({
        name: 'Primary',
        baseUrl: process.env.AI_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_API_KEY,
        model: process.env.AI_MODEL,
        timeout: 90000
      });
    }

    // 备用模型
    if (process.env.AI_FALLBACK_API_KEY && process.env.AI_FALLBACK_BASE_URL && process.env.AI_FALLBACK_MODEL) {
      models.push({
        name: 'Fallback',
        baseUrl: process.env.AI_FALLBACK_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_FALLBACK_API_KEY,
        model: process.env.AI_FALLBACK_MODEL,
        timeout: 90000
      });
    }

    // 国内模型（通义千问）
    if (process.env.AI_CN_API_KEY && process.env.AI_CN_BASE_URL && process.env.AI_CN_MODEL) {
      models.push({
        name: 'Qwen',
        baseUrl: process.env.AI_CN_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_CN_API_KEY,
        model: process.env.AI_CN_MODEL,
        timeout: 90000
      });
    }

    // 百度文心一言
    if (process.env.AI_BAIDU_API_KEY && process.env.AI_BAIDU_BASE_URL && process.env.AI_BAIDU_MODEL) {
      models.push({
        name: 'ERNIE',
        baseUrl: process.env.AI_BAIDU_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_BAIDU_API_KEY,
        model: process.env.AI_BAIDU_MODEL,
        timeout: 90000
      });
    }

    // Google Gemini
    if (process.env.AI_GEMINI_API_KEY && process.env.AI_GEMINI_BASE_URL && process.env.AI_GEMINI_MODEL) {
      models.push({
        name: 'Gemini',
        baseUrl: process.env.AI_GEMINI_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_GEMINI_API_KEY,
        model: process.env.AI_GEMINI_MODEL,
        timeout: 90000
      });
    }

    return models;
  }

  /**
   * 生成训练计划（自动尝试多个模型）
   */
  async generateTrainingPlan(
    context: AthleteContext,
    inputContent: string,
    inputType: 'text' | 'file'
  ): Promise<AIGenerationResult> {
    if (this.models.length === 0) {
      throw new Error('没有配置可用的 AI 模型，请检查环境变量');
    }

    const prompt = this.buildPrompt(context, inputContent, inputType);
    let lastError: Error | null = null;

    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i];
      try {
        console.log(`[AI] 尝试使用模型 ${model.name} (${model.model})...`);
        const result = await this.callModel(model, prompt);
        console.log(`[AI] 模型 ${model.name} 生成成功`);
        return {
          plan: result,
          modelUsed: `${model.name} (${model.model})`,
          attempts: i + 1
        };
      } catch (error) {
        console.warn(`[AI] 模型 ${model.name} 失败:`, error);
        lastError = error as Error;
        continue;
      }
    }

    throw new Error(`所有 AI 模型均失败，最后一个错误: ${lastError?.message}`);
  }

  /**
   * 构建 AI Prompt
   */
  private buildPrompt(
    context: AthleteContext,
    inputContent: string,
    inputType: 'text' | 'file'
  ): string {
    const inputDescription = inputType === 'file'
      ? '用户上传了训练相关文件，内容如下：'
      : '用户输入的训练需求描述：';

    return `你是一位资深的${context.athlete.project}项目体能训练专家教练，拥有丰富的国家队训练指导经验。

## 运动员基本信息
- 姓名：${context.athlete.name}
- 项目：${context.athlete.project}
- 组别：${context.athlete.team}
- 性别：${context.athlete.gender}
${context.athlete.region ? `- 地区：${context.athlete.region}` : ''}

## 历史训练计划（最近6个月）
${context.recentPlans.length > 0
  ? JSON.stringify(context.recentPlans.slice(0, 3), null, 2)
  : '暂无历史训练计划数据'}

## 近期训练记录（最近28天）
${context.recentRecords.length > 0
  ? JSON.stringify(context.recentRecords.slice(0, 10), null, 2)
  : '暂无近期训练记录'}

## 力量测试数据（最近3次）
${context.strengthTests.length > 0
  ? JSON.stringify(context.strengthTests.slice(0, 3), null, 2)
  : '暂无力量测试数据'}

## ${inputDescription}
${inputContent}

---

请根据以上信息，生成科学、个性化的训练计划：

### 分析要求：
1. **需求理解**：分析用户输入的训练需求或文件内容
2. **历史参考**：参考历史训练计划和数据，了解运动员的训练基础和习惯
3. **周期规划**：根据需求确定合理的训练周期（2-12周）
4. **渐进超负荷**：每周训练负荷合理递增，避免过度训练
5. **专项结合**：结合${context.athlete.project}项目的专项特点

### 输出格式（严格JSON）：
{
  "title": "训练计划标题（简洁有力）",
  "summary": "AI分析摘要：训练目标、重点、建议等（200字以内）",
  "durationWeeks": 4,
  "startDate": "2026-08-18",
  "endDate": "2026-09-15",
  "scheduleLabel": "周二/周四/周六",
  "bodyWeight": null,
  "age": null,
  "weeklyPlans": [
    {
      "weekNumber": 1,
      "focus": "本周训练重点",
      "totalLoad": 85,
      "days": [
        {
          "dayOfWeek": "周二",
          "exercises": [
            {"name": "卧拉", "sets": "4", "reps": "8", "percentage": 75, "notes": "控制节奏"},
            {"name": "深蹲", "sets": "3", "reps": "10", "percentage": 70}
          ]
        }
      ]
    }
  ],
  "exercises": [
    {"id": "${randomUUID().slice(0, 8)}", "name": "卧拉", "maxWeight": 65, "unitNote": "20"},
    {"id": "${randomUUID().slice(0, 8)}", "name": "深蹲", "maxWeight": 80, "unitNote": "20"}
  ]
}

### 重要说明：
- durationWeeks: 训练周期周数（2-12周，根据需求合理确定）
- percentage: 强度百分比（50-95之间）
- weeklyPlans数组长度必须等于durationWeeks
- 每个训练日的练习数量根据训练目标合理安排（3-6个）
- 必须输出合法的JSON格式，不要包含注释`;
  }

  /**
   * 调用 AI 模型
   */
  private async callModel(model: AIModelConfig, prompt: string): Promise<DynamicTrainingPlan> {
    const endpoint = model.baseUrl.endsWith('/chat/completions')
      ? model.baseUrl
      : `${model.baseUrl}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: JSON.stringify({
        model: model.model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是一位专业的赛艇和皮划艇体能训练教练。请严格按照用户要求的JSON格式输出，不要添加任何markdown代码块标记。'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      }),
      signal: AbortSignal.timeout(model.timeout)
    });

    if (!response.ok) {
      throw new Error(`API 返回错误: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error) {
      throw new Error(`API 错误: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('API 返回空内容');
    }

    // 清理响应内容（移除可能的 markdown 代码块）
    const cleanContent = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(cleanContent) as DynamicTrainingPlan;
      parsed.aiModel = model.model;
      return parsed;
    } catch (error) {
      throw new Error(`JSON 解析失败: ${(error as Error).message}`);
    }
  }

  /**
   * 将动态训练计划转换为传统格式（兼容现有存储）
   */
  convertToLegacyFormat(plan: DynamicTrainingPlan): {
    title: string;
    startDate: string;
    endDate: string;
    scheduleLabel: string;
    bodyWeight: number | null;
    age: number | null;
    exercises: LegacyExercise[];
  } {
    // 将新的动态格式转换为旧的 exercises 格式
    const exerciseMap = new Map<string, LegacyExercise>();

    plan.weeklyPlans.forEach((week) => {
      week.days.forEach((day) => {
        day.exercises.forEach((ex) => {
          if (!exerciseMap.has(ex.name)) {
            exerciseMap.set(ex.name, {
              id: randomUUID(),
              name: ex.name,
              maxWeight: null,
              unitNote: '',
              lines: [{
                id: randomUUID(),
                weeks: { '1': { sets: '', reps: '', percentage: null, actualCompleted: '' },
                         '2': { sets: '', reps: '', percentage: null, actualCompleted: '' },
                         '3': { sets: '', reps: '', percentage: null, actualCompleted: '' },
                         '4': { sets: '', reps: '', percentage: null, actualCompleted: '' }}
              }]
            });
          }
        });
      });
    });

    // 这里简化处理，实际应该根据周数动态调整
    return {
      title: plan.title,
      startDate: plan.startDate,
      endDate: plan.endDate,
      scheduleLabel: plan.scheduleLabel,
      bodyWeight: plan.bodyWeight,
      age: plan.age,
      exercises: Array.from(exerciseMap.values())
    };
  }
}

// 旧格式兼容类型
interface LegacyExercise {
  id: string;
  name: string;
  maxWeight: number | null;
  unitNote: string;
  lines: LegacyLine[];
}

interface LegacyLine {
  id: string;
  weeks: Record<string, { sets: string; reps: string; percentage: number | null; actualCompleted: string }>;
}

export type { AthleteContext, DynamicTrainingPlan, AIGenerationResult };
