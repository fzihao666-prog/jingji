import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8791';
const outputDir = resolve('outputs/batch-plan-import-20260731');

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path}: ${payload?.message || response.statusText}`);
  return payload;
}

await mkdir(outputDir, { recursive: true });
const login = await json('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin01', password: 'demo123' })
});
const headers = { Authorization: `Bearer ${login.token}` };
const { athletes } = await json('/api/athletes', { headers });
if (athletes.length < 2) throw new Error('测试至少需要2名可管理运动员。');

const templateResponse = await fetch(`${baseUrl}/api/training-plans/batch/template`, { headers });
if (!templateResponse.ok) throw new Error(`模板下载失败：${templateResponse.status}`);
const templateBytes = Buffer.from(await templateResponse.arrayBuffer());
const templatePath = resolve(outputDir, '多人四周训练计划导入模板.xlsx');
await writeFile(templatePath, templateBytes);

const form = new FormData();
form.append('file', new Blob([templateBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '多人四周训练计划导入模板.xlsx');
form.append('athleteIds', JSON.stringify(athletes.slice(0, 2).map((athlete) => athlete.id)));
const previewResponse = await fetch(`${baseUrl}/api/training-plans/batch/preview`, { method: 'POST', headers, body: form });
const preview = await previewResponse.json();
if (!previewResponse.ok) throw new Error(`预览失败：${preview.message}`);
if (preview.exerciseCount !== 3 || preview.athletes.length !== 2) throw new Error('预览统计不符合预期。');
const committed = await json('/api/training-plans/batch/commit', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ importId: preview.importId, replaceExisting: false })
});
const savedPlans = await Promise.all(athletes.slice(0, 2).map((athlete) => json(`/api/training-plans?athleteId=${athlete.id}`, { headers })));
if (committed.created + committed.replaced !== 2 || savedPlans.some(({ plans }) => !plans.some((plan) => plan.data.startDate === preview.data.startDate))) {
  throw new Error('批量生成后未找到两名运动员的个人计划。');
}

const report = {
  templatePath,
  templateBytes: templateBytes.length,
  preview: {
    title: preview.data.title,
    period: [preview.data.startDate, preview.data.endDate],
    exerciseCount: preview.exerciseCount,
    lineCount: preview.lineCount,
    athletes: preview.athletes.map(({ name, hasConflict, reusedMaxCount }) => ({ name, hasConflict, reusedMaxCount }))
  },
  commit: { created: committed.created, replaced: committed.replaced, skipped: committed.skipped },
  individualPlansVerified: savedPlans.length
};
await writeFile(resolve(outputDir, 'check-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
