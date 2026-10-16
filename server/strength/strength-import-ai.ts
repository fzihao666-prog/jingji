type ImportAthleteCandidate = {
  id: number;
  name: string;
  project: string;
  team: string;
  gender: string;
};

export type RecognizedStrengthRow = {
  trainingDate?: string;
  athleteName?: string;
  team?: string;
  sessionLabel?: string;
  exerciseName?: string;
  setIndex?: number;
  targetReps?: number | null;
  actualReps?: number;
  actualWeightKg?: number;
  rpe?: number | null;
  completed?: boolean;
  note?: string;
  confidence?: number | null;
  originalText?: string;
};

import { chatCompletion, cleanJson, configuredModels } from '../core/ai-client.ts';

export async function recognizeStrengthImport(input: {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  athletes: ImportAthleteCandidate[];
}) {
  const models = configuredModels();
  if (!models.length) throw new Error('当前环境未配置可用的AI识别模型，请改用Excel模板导入。');

  const athleteDirectory = input.athletes.slice(0, 300).map((athlete) => ({
    id: athlete.id,
    name: athlete.name,
    project: athlete.project,
    team: athlete.team,
    gender: athlete.gender,
  }));
  const prompt = `你是体育体能训练结果录入助手。请从附件中逐组提取已经完成的体能训练结果，不要生成训练计划。

可匹配的运动员名单：
${JSON.stringify(athleteDirectory)}

只输出合法JSON，结构如下：
{"rows":[{"trainingDate":"YYYY-MM-DD","athleteName":"姓名","team":"队伍","sessionLabel":"训练场次名称","exerciseName":"动作","setIndex":1,"targetReps":8,"actualReps":8,"actualWeightKg":60,"rpe":7.5,"completed":true,"note":"","confidence":0.95,"originalText":"原始行文字"}]}

要求：
1. 每个动作的每一组单独输出一行；如果原表写“4组×8次”，且没有逐组差异，请展开为4行。
2. 不确定的字段使用null或空字符串，不要猜测姓名、日期、重量和次数。
3. 重量统一为kg；磅需要换算为kg并在note说明。
4. confidence在0至1之间。
5. 找不到日期或运动员姓名时仍保留该行，交给用户校对。`;

  const dataUrl = `data:${input.mimetype};base64,${input.buffer.toString('base64')}`;
  const attachment =
    input.mimetype === 'application/pdf'
      ? { type: 'file', file: { filename: input.filename, file_data: dataUrl } }
      : { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } };

  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: '只识别已完成的体能训练结果，并严格输出 json 格式。' },
        { role: 'user', content: [{ type: 'text', text: prompt }, attachment] },
      ],
    });
    const parsed = JSON.parse(cleanJson(result.content)) as { rows?: RecognizedStrengthRow[] };
    if (!Array.isArray(parsed.rows)) throw new Error('识别结果缺少rows数组');
    return { rows: parsed.rows.slice(0, 1000), modelUsed: result.modelUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`AI未能识别该文件：${message}。可改用Excel模板导入。`);
  }
}
