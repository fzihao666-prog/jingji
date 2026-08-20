/**
 * AI 服务 - 支持多模型训练计划生成
 * 支持模型：OpenAI GPT-4、Claude、Gemini、文心一言、通义千问等
 */

import { randomUUID } from 'node:crypto';
import type { PreparedAIFile, PreparedAITextChunk } from './file-parser.ts';

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

export interface ImportedTrainingItem {
  id: string;
  name: string;
  category: string | null;
  sets: string | null;
  reps: string | null;
  load: string | null;
  percentage: number | null;
  duration: string | null;
  distance: string | null;
  intensity: string | null;
  pace: string | null;
  notes: string | null;
  rawText: string;
  confidence: number;
}

export interface ImportedTrainingDay {
  id: string;
  date: string | null;
  dayLabel: string;
  focus: string;
  items: ImportedTrainingItem[];
}

export interface ImportedTrainingWeek {
  id: string;
  weekNumber: number | null;
  label: string;
  focus: string;
  days: ImportedTrainingDay[];
}

export interface ImportedTrainingPlan {
  sourceType: 'ai_import';
  title: string;
  summary: string;
  startDate: string;
  endDate: string;
  scheduleLabel: string;
  bodyWeight: number | null;
  age: number | null;
  durationWeeks: number | null;
  weeklyPlans: ImportedTrainingWeek[];
  exercises: [];
  confidence: number;
  warnings: string[];
  unmappedContent: string[];
  aiModel: string;
}

export interface AIImportResult {
  plan: ImportedTrainingPlan;
  modelUsed: string;
  attempts: number;
}

export interface AIRecognizedTrainingRecord {
  sourceRow: string;
  athleteName: string;
  date: string;
  trainingType: string;
  structureType: string;
  intensityZone: string;
  content: string;
  durationMin: number | null;
  distanceKm: number | null;
  rpe: number | null;
  srpe: number | null;
  smvl: number | null;
  morningPulse: number | null;
  weightKg: number | null;
  sleepHours: number | null;
  fatigueIndex: number | null;
  status: string;
  coachNote: string;
  trainingBreakdown: Record<string, unknown>;
  confidence: number;
  warnings: string[];
}

export interface AITrainingDataImportResult {
  rows: AIRecognizedTrainingRecord[];
  summary: string;
  confidence: number;
  warnings: string[];
  unmappedContent: string[];
  modelUsed: string;
  attempts: number;
}

export type TrainingDocumentType = 'training_plan' | 'training_record' | 'mixed' | 'unknown';

export interface TrainingDocumentClassification {
  documentType: TrainingDocumentType;
  confidence: number;
  reason: string;
  modelUsed: string;
  attempts: number;
}

export type AIImportBatchProgress = {
  completed: number;
  total: number;
  label: string;
  status: 'processing' | 'completed' | 'failed';
};

export type AIImportBatchOptions = {
  sectionNames?: string[];
  concurrency?: number;
  onProgress?: (progress: AIImportBatchProgress) => void;
};

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
    const configuredTimeout = Number(process.env.AI_TIMEOUT_MS);
    const timeout = Number.isFinite(configuredTimeout) && configuredTimeout >= 30000
      ? configuredTimeout
      : 180000;

    // 主模型（优先级最高）
    if (process.env.AI_API_KEY && process.env.AI_BASE_URL && process.env.AI_MODEL) {
      models.push({
        name: 'Primary',
        baseUrl: process.env.AI_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_API_KEY,
        model: process.env.AI_MODEL,
        timeout
      });
    }

    // 备用模型
    if (process.env.AI_FALLBACK_API_KEY && process.env.AI_FALLBACK_BASE_URL && process.env.AI_FALLBACK_MODEL) {
      models.push({
        name: 'Fallback',
        baseUrl: process.env.AI_FALLBACK_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_FALLBACK_API_KEY,
        model: process.env.AI_FALLBACK_MODEL,
        timeout
      });
    }

    // 国内模型（通义千问）
    if (process.env.AI_CN_API_KEY && process.env.AI_CN_BASE_URL && process.env.AI_CN_MODEL) {
      models.push({
        name: 'Qwen',
        baseUrl: process.env.AI_CN_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_CN_API_KEY,
        model: process.env.AI_CN_MODEL,
        timeout
      });
    }

    // 百度文心一言
    if (process.env.AI_BAIDU_API_KEY && process.env.AI_BAIDU_BASE_URL && process.env.AI_BAIDU_MODEL) {
      models.push({
        name: 'ERNIE',
        baseUrl: process.env.AI_BAIDU_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_BAIDU_API_KEY,
        model: process.env.AI_BAIDU_MODEL,
        timeout
      });
    }

    // Google Gemini
    if (process.env.AI_GEMINI_API_KEY && process.env.AI_GEMINI_BASE_URL && process.env.AI_GEMINI_MODEL) {
      models.push({
        name: 'Gemini',
        baseUrl: process.env.AI_GEMINI_BASE_URL.replace(/\/+$/, ''),
        apiKey: process.env.AI_GEMINI_API_KEY,
        model: process.env.AI_GEMINI_MODEL,
        timeout
      });
    }

    return models;
  }

  /**
   * 生成训练计划（自动尝试多个模型）
   */
  async generateTrainingPlan(
    context: AthleteContext,
    inputContent: string
  ): Promise<AIGenerationResult> {
    if (this.models.length === 0) {
      throw new Error('没有配置可用的 AI 模型，请检查环境变量');
    }

    const prompt = this.buildPrompt(context, inputContent);
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
   * 从已有文件中忠实识别训练计划。该流程不读取历史训练数据，
   * 也不会补写周期、动作或负荷；无法确认的内容会进入 warnings/unmappedContent。
   */
  async recognizeTrainingPlan(
    context: AthleteContext,
    file: PreparedAIFile
  ): Promise<AIImportResult> {
    if (this.models.length === 0) {
      throw new Error('没有配置可用的 AI 模型，请检查环境变量');
    }

    const prompt = this.buildImportPrompt(context, file);
    let lastError: Error | null = null;

    for (let index = 0; index < this.models.length; index += 1) {
      const model = this.models[index];
      try {
        console.log(`[AI Import] 尝试使用模型 ${model.name} (${model.model})...`);
        const plan = await this.callImportModel(model, prompt, file);
        plan.aiModel = model.model;
        return {
          plan,
          modelUsed: `${model.name} (${model.model})`,
          attempts: index + 1
        };
      } catch (error) {
        console.warn(`[AI Import] 模型 ${model.name} 失败:`, error);
        lastError = error as Error;
      }
    }

    throw new Error(`所有 AI 模型均失败，最后一个错误: ${lastError?.message}`);
  }

  /**
   * 先判断原文件属于计划、完成记录还是混合文档。分类只读取各批次的少量样本，
   * 不依赖固定工作表名称或固定表头。
   */
  async classifyTrainingDocument(project: string, file: PreparedAIFile): Promise<TrainingDocumentClassification> {
    if (this.models.length === 0) throw new Error('没有配置可用的 AI 模型，请检查环境变量');
    const prompt = this.buildDocumentClassificationPrompt(project, file);
    let lastError: Error | null = null;
    for (let index = 0; index < this.models.length; index += 1) {
      const model = this.models[index];
      try {
        const result = await this.callDocumentClassificationModel(model, prompt, file);
        return {
          ...result,
          modelUsed: `${model.name} (${model.model})`,
          attempts: index + 1
        };
      } catch (error) {
        console.warn(`[AI Document Classification] 模型 ${model.name} 失败:`, error);
        lastError = error as Error;
      }
    }
    throw new Error(`所有 AI 模型均失败，最后一个错误: ${lastError?.message}`);
  }

  /** 完整工作簿按通用文本批次识别为训练计划，并在服务端合并。 */
  async recognizeTrainingPlanBatched(
    context: AthleteContext,
    file: PreparedAIFile,
    options: AIImportBatchOptions = {}
  ): Promise<AIImportResult & { processedChunks: number; failedChunks: number }> {
    const chunks = selectedFileChunks(file, options.sectionNames);
    const failures: Array<{ label: string; message: string }> = [];
    let completed = 0;
    const results = await mapWithConcurrency(
      chunks,
      normalizedConcurrency(options.concurrency),
      async (chunk) => {
        options.onProgress?.({ completed, total: chunks.length, label: chunk.label, status: 'processing' });
        try {
          const result = await this.recognizeTrainingPlan(context, fileForChunk(file, chunk));
          result.plan.title ||= file.metadata.filename.replace(/\.[^.]+$/, '');
          result.plan.weeklyPlans = result.plan.weeklyPlans.map((week) => ({
            ...week,
            label: week.label || chunk.sectionName
          }));
          completed += 1;
          options.onProgress?.({ completed, total: chunks.length, label: chunk.label, status: 'completed' });
          return result;
        } catch (error) {
          completed += 1;
          const message = error instanceof Error ? error.message : '未知错误';
          failures.push({ label: chunk.label, message });
          options.onProgress?.({ completed, total: chunks.length, label: chunk.label, status: 'failed' });
          return null;
        }
      }
    );
    const successful = results.filter((result): result is AIImportResult => Boolean(result));
    if (!successful.length) throw new Error(`全部${chunks.length}个批次识别失败${failures[0] ? `：${failures[0].message}` : ''}`);
    const plan = mergeImportedPlans(successful.map((result) => result.plan), file.metadata.filename);
    if (failures.length) {
      plan.warnings.push(...failures.map((failure) => `${failure.label}识别失败：${failure.message}`));
    }
    return {
      plan,
      modelUsed: [...new Set(successful.map((result) => result.modelUsed))].join('、'),
      attempts: Math.max(...successful.map((result) => result.attempts)),
      processedChunks: successful.length,
      failedChunks: failures.length
    };
  }

  /** 完整工作簿按通用文本批次识别为逐人逐日完成记录，并在服务端合并。 */
  async recognizeTrainingRecordsBatched(
    project: string,
    athletes: Array<{ name: string; team: string }>,
    file: PreparedAIFile,
    options: AIImportBatchOptions = {}
  ): Promise<AITrainingDataImportResult & { processedChunks: number; failedChunks: number }> {
    const chunks = selectedFileChunks(file, options.sectionNames);
    const failures: Array<{ label: string; message: string }> = [];
    let completed = 0;
    const results = await mapWithConcurrency(
      chunks,
      normalizedConcurrency(options.concurrency),
      async (chunk) => {
        options.onProgress?.({ completed, total: chunks.length, label: chunk.label, status: 'processing' });
        try {
          const result = await this.recognizeTrainingRecords(project, athletes, fileForChunk(file, chunk));
          completed += 1;
          options.onProgress?.({ completed, total: chunks.length, label: chunk.label, status: 'completed' });
          return result;
        } catch (error) {
          completed += 1;
          const message = error instanceof Error ? error.message : '未知错误';
          failures.push({ label: chunk.label, message });
          options.onProgress?.({ completed, total: chunks.length, label: chunk.label, status: 'failed' });
          return null;
        }
      }
    );
    const successful = results.filter((result): result is AITrainingDataImportResult => Boolean(result));
    if (!successful.length) throw new Error(`全部${chunks.length}个批次识别失败${failures[0] ? `：${failures[0].message}` : ''}`);
    const merged = mergeTrainingDataResults(successful);
    if (failures.length) {
      merged.warnings.push(...failures.map((failure) => `${failure.label}识别失败：${failure.message}`));
    }
    return {
      ...merged,
      modelUsed: [...new Set(successful.map((result) => result.modelUsed))].join('、'),
      attempts: Math.max(...successful.map((result) => result.attempts)),
      processedChunks: successful.length,
      failedChunks: failures.length
    };
  }

  /**
   * 从任意结构的训练记录文件中提取逐人逐日记录。沿用训练计划相同的模型配置，
   * 只做忠实识别，不补写文件中不存在的训练数据。
   */
  async recognizeTrainingRecords(
    project: string,
    athletes: Array<{ name: string; team: string }>,
    file: PreparedAIFile
  ): Promise<AITrainingDataImportResult> {
    if (this.models.length === 0) {
      throw new Error('没有配置可用的 AI 模型，请检查环境变量');
    }

    const prompt = this.buildTrainingDataImportPrompt(project, athletes, file);
    let lastError: Error | null = null;
    for (let index = 0; index < this.models.length; index += 1) {
      const model = this.models[index];
      try {
        console.log(`[AI Data Import] 尝试使用模型 ${model.name} (${model.model})...`);
        const recognized = await this.callTrainingDataImportModel(model, prompt, file);
        return {
          ...recognized,
          modelUsed: `${model.name} (${model.model})`,
          attempts: index + 1
        };
      } catch (error) {
        console.warn(`[AI Data Import] 模型 ${model.name} 失败:`, error);
        lastError = error as Error;
      }
    }
    throw new Error(`所有 AI 模型均失败，最后一个错误: ${lastError?.message}`);
  }

  private buildTrainingDataImportPrompt(
    project: string,
    athletes: Array<{ name: string; team: string }>,
    file: PreparedAIFile
  ): string {
    const roster = athletes.map((athlete) => `${athlete.name}（${athlete.team}）`).join('、');
    const source = file.kind === 'text'
      ? `\n\n## 文件中提取的原始内容\n${file.content}`
      : '\n\n图片作为本消息的视觉输入提供，请逐行阅读图片文字和表格。';
    return `你是竞技体育训练数据数字化录入员。请从当前文件批次中识别${project}项目的逐人逐日训练记录，并转换为结构化 JSON。

## 当前账户可导入的运动员
${roster || '无'}

核心规则：
1. 只提取文件明确存在的信息，不编造姓名、日期、时长、距离、强度、RPE或恢复指标。
2. 文件可能是任意版式的Excel、Word、PDF、文本或图片，不假定固定表头；同一运动员同一天合并为一条记录。
3. 只有运动员完整姓名明确出现在该条sourceRow原文中，athleteName才能匹配名单；原文只有组别、艇号或没有姓名时必须留空，严禁根据名单、顺序或经验猜人。
4. 日期能确定时统一为 YYYY-MM-DD；原文未明确年份时必须留空，严禁根据当前时间、经验或模型知识补写年份。
5. 所有时长统一换算为分钟，距离统一换算为公里；原文只有“2小时”时durationMin填120。
6. RPE和fatigueIndex范围0—10；未出现的数值字段必须为null，不能用0代替未知。
7. trainingBreakdown只填写原文件明确给出的非零分项；未知项可以省略。强度分区键固定为U3、U2、U1、AT、TPT、AN、ATP。
8. sourceRow保留对应的原始文字或单元格摘要；每行confidence为0到1。
9. 不确定、冲突或无法归类的内容写入warnings或unmappedContent，不能静默丢弃。

只输出合法JSON，不要Markdown，结构如下：
{
  "summary": "对识别内容的一句客观概括",
  "confidence": 0.9,
  "warnings": [],
  "unmappedContent": [],
  "rows": [
    {
      "sourceRow": "原始文字或单元格摘要",
      "athleteName": "运动员姓名",
      "date": "YYYY-MM-DD或空字符串",
      "trainingType": "水上训练/测功仪训练/力量训练/恢复训练/综合训练等",
      "structureType": "原文结构分类或训练类型",
      "intensityZone": "U2等原文强度或-",
      "content": "训练内容",
      "durationMin": null,
      "distanceKm": null,
      "rpe": null,
      "srpe": null,
      "smvl": null,
      "morningPulse": null,
      "weightKg": null,
      "sleepHours": null,
      "fatigueIndex": null,
      "status": "normal/attention/alert/rest/missing",
      "coachNote": "备注",
      "trainingBreakdown": {"waterMinutes":30,"waterDistanceByZone":{"U2":8}},
      "confidence": 0.9,
      "warnings": []
    }
  ]
}${source}`;
  }

  private buildDocumentClassificationPrompt(project: string, file: PreparedAIFile): string {
    return `你是竞技体育文档分类员。请判断这份${project}文件的主要用途，不要提取具体训练条目。

分类定义：
- training_plan：描述未来或预定的周计划、日程、处方、训练安排，即使含有汇总负荷。
- training_record：记录已经完成的逐人训练、监测、RPE、恢复或实际完成量。
- mixed：同一文件同时包含可分离的计划和完成记录。
- unknown：证据不足。

只输出合法JSON：
{"documentType":"training_plan|training_record|mixed|unknown","confidence":0到1,"reason":"一句客观理由"}

## 文件概览
文件名：${file.metadata.filename}
提取方式：${file.metadata.extractionMethod}
${classificationSample(file)}`;
  }

  private buildImportPrompt(context: AthleteContext, file: PreparedAIFile): string {
    const source = file.kind === 'text'
      ? `\n\n## 文件中提取的原始内容\n${file.content}`
      : '\n\n图片作为本消息的视觉输入提供，请逐项阅读图片文字和表格。';

    return `你是训练计划数字化录入员。请把已有文件忠实转换为结构化数据。该计划可能会分配给一名或多名${context.athlete.project}运动员，不能根据某位运动员的历史数据改写原文件。

核心规则：
1. 只提取文件中明确存在的内容，不生成新计划，不优化、不改写、不补全训练学建议。
2. 不假定文件有固定表头、固定四周、固定训练日或固定动作类型；按原文件实际层级组织。
3. 无法确认的字段使用 null 或空字符串，并在 warnings 中说明；不能归类但需要保留的原文放入 unmappedContent。
4. sets/reps/load/duration/distance/intensity/pace 均保留原文件的表达，例如“4组”“8-10次”“60kg”“30min”。percentage 只有明确百分比时才填写数字。
5. rawText 必须保留该训练条目的原始文字，confidence 为 0 到 1。
6. 日期只在原文能够确定时输出 YYYY-MM-DD；不能确定年份或日期时留空，等待人工确认。
7. 必须逐一覆盖原文件中明确出现的每个日期或星期，不得只提取有大段文字描述的日期。
8. 某天即使没有叙述文字，只要表格明确给出了该日的距离、时间、强度分区或力量/恢复等分类汇总，也要按明确表头生成“水上训练汇总”“测功仪训练汇总”“最大力量汇总”“拉伸再生汇总”等客观条目。distance、duration、intensity、notes 只填写对应单元格明确给出的值，rawText 保留该日相关单元格摘要；不得臆造动作、组数、次数或训练目的。
9. 某天确实只有日期/星期而没有任何训练文字或数值时，仍保留该 day、items 为空，并在 warnings 中说明“该日无可识别训练明细”，不能静默遗漏。

只输出合法 JSON，不要 Markdown。结构如下（数组长度完全由原文件决定）：
{
  "title": "文件中的计划标题或空字符串",
  "summary": "对文件内容的一句客观概括，不添加建议",
  "startDate": "YYYY-MM-DD或空字符串",
  "endDate": "YYYY-MM-DD或空字符串",
  "scheduleLabel": "原文件中的训练安排描述或空字符串",
  "bodyWeight": null,
  "age": null,
  "durationWeeks": null,
  "weeklyPlans": [
    {
      "weekNumber": null,
      "label": "原文件周次/阶段标题或未分周",
      "focus": "原文件明确写出的重点或空字符串",
      "days": [
        {
          "date": null,
          "dayLabel": "日期、星期或训练单元名称",
          "focus": "原文件明确写出的重点或空字符串",
          "items": [
            {
              "name": "训练项目名称",
              "category": null,
              "sets": null,
              "reps": null,
              "load": null,
              "percentage": null,
              "duration": null,
              "distance": null,
              "intensity": null,
              "pace": null,
              "notes": null,
              "rawText": "对应原文",
              "confidence": 0.9
            }
          ]
        }
      ]
    }
  ],
  "confidence": 0.9,
  "warnings": [],
  "unmappedContent": []
}${source}`;
  }

  /**
   * 构建 AI Prompt
   */
  private buildPrompt(
    context: AthleteContext,
    inputContent: string
  ): string {
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

## 用户输入的训练需求描述
${inputContent}

---

请根据以上信息，生成科学、个性化的训练计划：

### 分析要求：
1. **需求理解**：分析用户输入的训练需求或文件内容
2. **历史参考**：参考历史训练计划和数据，了解运动员的训练基础和习惯
3. **周期规划**：用户未明确周期时默认生成4周；用户明确提出周期时，在2-12周范围内执行
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
        ...(model.model.toLowerCase().startsWith('qwen') ? { enable_thinking: false } : {}),
        max_completion_tokens: 12000,
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

  private async callImportModel(
    model: AIModelConfig,
    prompt: string,
    file: PreparedAIFile
  ): Promise<ImportedTrainingPlan> {
    const endpoint = model.baseUrl.endsWith('/chat/completions')
      ? model.baseUrl
      : `${model.baseUrl}/chat/completions`;
    const userContent = file.kind === 'image'
      ? [
          { type: 'image_url', image_url: { url: file.dataUrl } },
          { type: 'text', text: prompt }
        ]
      : prompt;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: JSON.stringify({
        model: model.model,
        temperature: 0,
        ...(model.model.toLowerCase().startsWith('qwen') ? { enable_thinking: false } : {}),
        max_completion_tokens: 16000,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你只负责把已有训练计划忠实录入为 JSON。严禁创造、优化、补全或套用固定模板。'
          },
          { role: 'user', content: userContent }
        ]
      }),
      signal: AbortSignal.timeout(model.timeout)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`API 返回错误: ${response.status} ${response.statusText}${detail ? ` - ${detail.slice(0, 300)}` : ''}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error) throw new Error(`API 错误: ${data.error.message}`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('API 返回空内容');

    try {
      const parsed = JSON.parse(cleanJsonContent(content)) as Record<string, unknown>;
      return normalizeImportedPlan(parsed, model.model);
    } catch (error) {
      throw new Error(`识别结果解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private async callTrainingDataImportModel(
    model: AIModelConfig,
    prompt: string,
    file: PreparedAIFile
  ): Promise<Omit<AITrainingDataImportResult, 'modelUsed' | 'attempts'>> {
    const endpoint = model.baseUrl.endsWith('/chat/completions')
      ? model.baseUrl
      : `${model.baseUrl}/chat/completions`;
    const userContent = file.kind === 'image'
      ? [
          { type: 'image_url', image_url: { url: file.dataUrl } },
          { type: 'text', text: prompt }
        ]
      : prompt;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: JSON.stringify({
        model: model.model,
        temperature: 0,
        ...(model.model.toLowerCase().startsWith('qwen') ? { enable_thinking: false } : {}),
        max_completion_tokens: 16000,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你只负责把已有训练记录忠实识别为逐人逐日JSON。严禁编造、推测、补写年份或套用固定Excel模板。'
          },
          { role: 'user', content: userContent }
        ]
      }),
      signal: AbortSignal.timeout(model.timeout)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`API 返回错误: ${response.status} ${response.statusText}${detail ? ` - ${detail.slice(0, 300)}` : ''}`);
    }
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error) throw new Error(`API 错误: ${data.error.message}`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('API 返回空内容');
    try {
      return normalizeAITrainingDataImport(JSON.parse(cleanJsonContent(content)) as Record<string, unknown>);
    } catch (error) {
      throw new Error(`训练数据识别结果解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private async callDocumentClassificationModel(
    model: AIModelConfig,
    prompt: string,
    file: PreparedAIFile
  ): Promise<Omit<TrainingDocumentClassification, 'modelUsed' | 'attempts'>> {
    const endpoint = model.baseUrl.endsWith('/chat/completions')
      ? model.baseUrl
      : `${model.baseUrl}/chat/completions`;
    const userContent = file.kind === 'image'
      ? [
          { type: 'image_url', image_url: { url: file.dataUrl } },
          { type: 'text', text: prompt }
        ]
      : prompt;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: JSON.stringify({
        model: model.model,
        temperature: 0,
        ...(model.model.toLowerCase().startsWith('qwen') ? { enable_thinking: false } : {}),
        max_completion_tokens: 1000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你只判断训练文件的主要用途，不能提取、改写或补全训练内容。' },
          { role: 'user', content: userContent }
        ]
      }),
      signal: AbortSignal.timeout(model.timeout)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`API 返回错误: ${response.status} ${response.statusText}${detail ? ` - ${detail.slice(0, 300)}` : ''}`);
    }
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error) throw new Error(`API 错误: ${data.error.message}`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('API 返回空内容');
    const parsed = asRecord(JSON.parse(cleanJsonContent(content)));
    const documentType = asText(parsed.documentType) as TrainingDocumentType;
    return {
      documentType: ['training_plan', 'training_record', 'mixed', 'unknown'].includes(documentType)
        ? documentType
        : 'unknown',
      confidence: clampConfidence(parsed.confidence),
      reason: asText(parsed.reason)
    };
  }
}

function selectedFileChunks(file: PreparedAIFile, sectionNames?: string[]): PreparedAITextChunk[] {
  if (file.kind === 'image') {
    return [{ id: 'image-1', label: '图片内容', sectionName: '图片内容', order: 0, content: '' }];
  }
  const selected = sectionNames?.length ? new Set(sectionNames) : null;
  const chunks = selected ? file.chunks.filter((chunk) => selected.has(chunk.sectionName)) : file.chunks;
  if (!chunks.length) throw new Error('没有选择可识别的工作表或内容批次');
  return [...chunks].sort((left, right) => left.order - right.order);
}

function fileForChunk(file: PreparedAIFile, chunk: PreparedAITextChunk): PreparedAIFile {
  if (file.kind === 'image') return file;
  return {
    kind: 'text',
    content: chunk.content,
    chunks: [chunk],
    metadata: {
      ...file.metadata,
      chunkCount: 1,
      sections: [{ name: chunk.sectionName, chunkCount: 1, characterCount: chunk.content.length }],
      warnings: []
    }
  };
}

function classificationSample(file: PreparedAIFile): string {
  if (file.kind === 'image') return '图片文件，请根据视觉内容判断。';
  const seen = new Set<string>();
  const samples: string[] = [];
  let total = 0;
  for (const chunk of file.chunks) {
    if (seen.has(chunk.sectionName)) continue;
    seen.add(chunk.sectionName);
    const sample = `### ${chunk.sectionName}\n${chunk.content.slice(0, 520)}`;
    if (total + sample.length > 20_000) break;
    samples.push(sample);
    total += sample.length;
  }
  return samples.join('\n\n');
}

function normalizedConcurrency(value?: number): number {
  const configured = Number(value ?? process.env.AI_IMPORT_CONCURRENCY ?? 2);
  return Number.isFinite(configured) ? Math.max(1, Math.min(4, Math.floor(configured))) : 2;
}

async function mapWithConcurrency<Input, Output>(
  values: Input[],
  concurrency: number,
  worker: (value: Input, index: number) => Promise<Output>
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function uniqueText(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => asText(value)).filter(Boolean))];
}

function mergeImportedPlans(plans: ImportedTrainingPlan[], filename: string): ImportedTrainingPlan {
  const weekMap = new Map<string, ImportedTrainingWeek>();
  for (const plan of plans) {
    for (const week of plan.weeklyPlans) {
      const firstDate = week.days.map((day) => day.date || '').filter(Boolean).sort()[0] || '';
      const key = `${week.label}|${week.weekNumber ?? ''}|${firstDate}`;
      const existing = weekMap.get(key);
      if (!existing) {
        weekMap.set(key, {
          ...week,
          days: week.days.map((day) => ({ ...day, items: [...day.items] }))
        });
        continue;
      }
      existing.focus = uniqueText([existing.focus, week.focus]).join('；');
      for (const day of week.days) {
        const dayKey = `${day.date || ''}|${day.dayLabel}`;
        const existingDay = existing.days.find((candidate) => `${candidate.date || ''}|${candidate.dayLabel}` === dayKey);
        if (!existingDay) {
          existing.days.push({ ...day, items: [...day.items] });
          continue;
        }
        existingDay.focus = uniqueText([existingDay.focus, day.focus]).join('；');
        const seenItems = new Set(existingDay.items.map((item) => `${item.name}|${item.rawText}`));
        for (const item of day.items) {
          const itemKey = `${item.name}|${item.rawText}`;
          if (!seenItems.has(itemKey)) {
            existingDay.items.push(item);
            seenItems.add(itemKey);
          }
        }
      }
    }
  }
  const weeklyPlans = [...weekMap.values()].sort((left, right) => {
    const leftDate = left.days.map((day) => day.date || '').filter(Boolean).sort()[0] || '9999';
    const rightDate = right.days.map((day) => day.date || '').filter(Boolean).sort()[0] || '9999';
    return leftDate.localeCompare(rightDate) || (left.weekNumber ?? 999) - (right.weekNumber ?? 999);
  });
  const dayDates = weeklyPlans
    .flatMap((week) => week.days.map((day) => day.date || ''))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const startDates = [...plans.map((plan) => plan.startDate), ...dayDates]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const endDates = [...plans.map((plan) => plan.endDate), ...dayDates]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const confidences = plans.map((plan) => plan.confidence).filter(Number.isFinite);
  return {
    sourceType: 'ai_import',
    title: plans.map((plan) => plan.title).find(Boolean) || filename.replace(/\.[^.]+$/, ''),
    summary: uniqueText(plans.map((plan) => plan.summary)).join('；').slice(0, 2000),
    startDate: startDates[0] || '',
    endDate: endDates.at(-1) || '',
    scheduleLabel: uniqueText(plans.map((plan) => plan.scheduleLabel)).join('；').slice(0, 500),
    bodyWeight: plans.find((plan) => plan.bodyWeight !== null)?.bodyWeight ?? null,
    age: plans.find((plan) => plan.age !== null)?.age ?? null,
    durationWeeks: weeklyPlans.length,
    weeklyPlans,
    exercises: [],
    confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0.5,
    warnings: uniqueText(plans.flatMap((plan) => plan.warnings)),
    unmappedContent: uniqueText(plans.flatMap((plan) => plan.unmappedContent)),
    aiModel: uniqueText(plans.map((plan) => plan.aiModel)).join('、')
  };
}

function sumBreakdownValues(left: unknown, right: unknown): unknown {
  if (typeof left === 'number' || typeof right === 'number') {
    return (Number(left) || 0) + (Number(right) || 0);
  }
  if (left && typeof left === 'object' && !Array.isArray(left) || right && typeof right === 'object' && !Array.isArray(right)) {
    const leftRecord = asRecord(left);
    const rightRecord = asRecord(right);
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    return Object.fromEntries([...keys].map((key) => [key, sumBreakdownValues(leftRecord[key], rightRecord[key])]));
  }
  return right ?? left;
}

function mergeTrainingRecord(left: AIRecognizedTrainingRecord, right: AIRecognizedTrainingRecord): AIRecognizedTrainingRecord {
  if (left.sourceRow === right.sourceRow && left.content === right.content) return left;
  const warnings = [...left.warnings, ...right.warnings];
  const chooseNumber = (label: string, first: number | null, second: number | null) => {
    if (first === null) return second;
    if (second === null || first === second) return first;
    warnings.push(`${label}在同日不同批次中不一致，已保留首个值`);
    return first;
  };
  return {
    ...left,
    sourceRow: uniqueText([left.sourceRow, right.sourceRow]).join('；'),
    trainingType: uniqueText([left.trainingType, right.trainingType]).join(' + '),
    structureType: uniqueText([left.structureType, right.structureType]).join(' + '),
    intensityZone: uniqueText([left.intensityZone, right.intensityZone]).join('/'),
    content: uniqueText([left.content, right.content]).join('；'),
    durationMin: (left.durationMin ?? 0) + (right.durationMin ?? 0),
    distanceKm: (left.distanceKm ?? 0) + (right.distanceKm ?? 0),
    rpe: chooseNumber('RPE', left.rpe, right.rpe),
    srpe: chooseNumber('sRPE', left.srpe, right.srpe),
    smvl: chooseNumber('SMVL', left.smvl, right.smvl),
    morningPulse: chooseNumber('晨脉', left.morningPulse, right.morningPulse),
    weightKg: chooseNumber('体重', left.weightKg, right.weightKg),
    sleepHours: chooseNumber('睡眠', left.sleepHours, right.sleepHours),
    fatigueIndex: chooseNumber('疲劳指数', left.fatigueIndex, right.fatigueIndex),
    coachNote: uniqueText([left.coachNote, right.coachNote]).join('；'),
    trainingBreakdown: asRecord(sumBreakdownValues(left.trainingBreakdown, right.trainingBreakdown)),
    confidence: Math.min(left.confidence, right.confidence),
    warnings: uniqueText(warnings)
  };
}

function mergeTrainingDataResults(results: AITrainingDataImportResult[]): AITrainingDataImportResult {
  const rowMap = new Map<string, AIRecognizedTrainingRecord>();
  for (const result of results) {
    for (const row of result.rows) {
      const athlete = row.athleteName.trim().toLocaleLowerCase();
      const key = athlete && row.date
        ? `${athlete}|${row.date}`
        : `${athlete}|${row.date}|${row.sourceRow}|${row.content}`;
      const existing = rowMap.get(key);
      rowMap.set(key, existing ? mergeTrainingRecord(existing, row) : row);
    }
  }
  const confidences = results.map((result) => result.confidence).filter(Number.isFinite);
  return {
    rows: [...rowMap.values()],
    summary: uniqueText(results.map((result) => result.summary)).join('；').slice(0, 2000),
    confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0.5,
    warnings: uniqueText(results.flatMap((result) => result.warnings)),
    unmappedContent: uniqueText(results.flatMap((result) => result.unmappedContent)),
    modelUsed: '',
    attempts: 1
  };
}

function cleanJsonContent(content: string): string {
  return content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim();
}

function asNullableText(value: unknown): string | null {
  const text = asText(value);
  return text ? text : null;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asText).filter(Boolean) : [];
}

function clampConfidence(value: unknown, fallback = 0.5): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function normalizeAITrainingDataImport(raw: Record<string, unknown>): Omit<AITrainingDataImportResult, 'modelUsed' | 'attempts'> {
  const sourceRows = Array.isArray(raw.rows)
    ? raw.rows
    : Array.isArray(raw.records) ? raw.records : [];
  const rows = sourceRows.map((value): AIRecognizedTrainingRecord => {
    const row = asRecord(value);
    return {
      sourceRow: asText(row.sourceRow || row.rawText),
      athleteName: asText(row.athleteName || row.athlete),
      date: asText(row.date),
      trainingType: asText(row.trainingType),
      structureType: asText(row.structureType),
      intensityZone: asText(row.intensityZone),
      content: asText(row.content),
      durationMin: asNullableNumber(row.durationMin),
      distanceKm: asNullableNumber(row.distanceKm),
      rpe: asNullableNumber(row.rpe),
      srpe: asNullableNumber(row.srpe),
      smvl: asNullableNumber(row.smvl),
      morningPulse: asNullableNumber(row.morningPulse),
      weightKg: asNullableNumber(row.weightKg),
      sleepHours: asNullableNumber(row.sleepHours),
      fatigueIndex: asNullableNumber(row.fatigueIndex),
      status: asText(row.status),
      coachNote: asText(row.coachNote),
      trainingBreakdown: asRecord(row.trainingBreakdown),
      confidence: clampConfidence(row.confidence),
      warnings: asTextArray(row.warnings)
    };
  }).filter((row) => row.sourceRow || row.athleteName || row.date || row.content);
  if (!rows.length) throw new Error('文件中没有识别到逐人逐日训练记录');
  if (rows.length > 300) throw new Error('单次识别记录超过300条，请拆分文件后重试');
  return {
    rows,
    summary: asText(raw.summary),
    confidence: clampConfidence(raw.confidence),
    warnings: asTextArray(raw.warnings),
    unmappedContent: asTextArray(raw.unmappedContent)
  };
}

function normalizeImportedPlan(raw: Record<string, unknown>, model: string): ImportedTrainingPlan {
  const sourceWeeks = Array.isArray(raw.weeklyPlans)
    ? raw.weeklyPlans
    : Array.isArray(raw.weeks) ? raw.weeks : [];
  const weeklyPlans = sourceWeeks.map((weekValue): ImportedTrainingWeek => {
    const week = asRecord(weekValue);
    const sourceDays = Array.isArray(week.days) ? week.days : [];
    return {
      id: randomUUID(),
      weekNumber: asNullableNumber(week.weekNumber),
      label: asText(week.label),
      focus: asText(week.focus),
      days: sourceDays.map((dayValue): ImportedTrainingDay => {
        const day = asRecord(dayValue);
        const sourceItems = Array.isArray(day.items)
          ? day.items
          : Array.isArray(day.exercises) ? day.exercises : [];
        return {
          id: randomUUID(),
          date: asNullableText(day.date),
          dayLabel: asText(day.dayLabel || day.dayOfWeek),
          focus: asText(day.focus),
          items: sourceItems.map((itemValue): ImportedTrainingItem => {
            const item = asRecord(itemValue);
            const name = asText(item.name);
            return {
              id: randomUUID(),
              name,
              category: asNullableText(item.category),
              sets: asNullableText(item.sets),
              reps: asNullableText(item.reps),
              load: asNullableText(item.load || item.weight || item.plannedWeight),
              percentage: asNullableNumber(item.percentage),
              duration: asNullableText(item.duration),
              distance: asNullableText(item.distance),
              intensity: asNullableText(item.intensity),
              pace: asNullableText(item.pace),
              notes: asNullableText(item.notes),
              rawText: asText(item.rawText) || name,
              confidence: clampConfidence(item.confidence)
            };
          }).filter((item) => item.name || item.rawText)
        };
      }).filter((day) => day.items.length > 0 || day.dayLabel || day.focus)
    };
  }).filter((week) => week.days.length > 0 || week.label || week.focus);

  const itemCount = weeklyPlans.reduce(
    (total, week) => total + week.days.reduce((dayTotal, day) => dayTotal + day.items.length, 0),
    0
  );
  if (itemCount === 0) throw new Error('文件中没有识别到训练条目，请确认文件内容清晰且包含训练计划');

  return {
    sourceType: 'ai_import',
    title: asText(raw.title),
    summary: asText(raw.summary),
    startDate: asText(raw.startDate),
    endDate: asText(raw.endDate),
    scheduleLabel: asText(raw.scheduleLabel),
    bodyWeight: asNullableNumber(raw.bodyWeight),
    age: asNullableNumber(raw.age),
    durationWeeks: asNullableNumber(raw.durationWeeks),
    weeklyPlans,
    exercises: [],
    confidence: clampConfidence(raw.confidence),
    warnings: asTextArray(raw.warnings),
    unmappedContent: asTextArray(raw.unmappedContent),
    aiModel: model
  };
}

export type { AthleteContext, DynamicTrainingPlan, AIGenerationResult };
