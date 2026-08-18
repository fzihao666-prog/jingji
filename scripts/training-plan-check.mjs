import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const projectRoot = process.cwd();
const testRoot = path.resolve(projectRoot, 'tmp', 'training-plan-check');
if (!testRoot.startsWith(`${path.resolve(projectRoot)}${path.sep}`)) {
  throw new Error('临时测试目录不在项目内。');
}
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });
const databasePath = path.join(testRoot, 'training-plan-check.db');
const photoRoot = path.join(testRoot, 'athlete-photos');
const exportPath = path.join(testRoot, 'training-plan-export.xlsx');
const port = 8791;
const baseUrl = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(port),
    DATABASE_PATH: databasePath,
    ATHLETE_PHOTO_ROOT: photoRoot,
    JWT_SECRET: 'training-plan-check-secret-training-plan-check-secret'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`测试服务启动失败：${serverOutput}`);
}

async function login(username) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'demo123' })
  });
  if (!response.ok) throw new Error(`${username}登录失败：${await response.text()}`);
  return (await response.json()).token;
}

async function jsonRequest(url, token, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  return { response, payload: await response.json().catch(() => null) };
}

try {
  await waitForServer();
  const coachToken = await login('coach01');
  const athleteToken = await login('athlete01');
  const plansResult = await jsonRequest('/api/training-plans?athleteId=1', coachToken);
  if (!plansResult.response.ok || !plansResult.payload?.plans?.length) throw new Error('未读取到示例训练计划。');
  const plan = plansResult.payload.plans[0];
  plan.data.exercises[0].lines[0].weeks['1'].actualCompleted = '8';

  const saveResult = await jsonRequest('/api/training-plans', coachToken, {
    method: 'POST',
    body: JSON.stringify({ athleteId: 1, data: plan.data })
  });
  if (!saveResult.response.ok) throw new Error(`教练保存失败：${saveResult.payload?.message}`);

  const nineExerciseData = structuredClone(plan.data);
  while (nineExerciseData.exercises.length < 9) {
    const copy = structuredClone(nineExerciseData.exercises[0]);
    copy.id = `limit-${nineExerciseData.exercises.length + 1}`;
    copy.name = `项目${nineExerciseData.exercises.length + 1}`;
    copy.lines = copy.lines.slice(0, 1);
    nineExerciseData.exercises.push(copy);
  }
  const nineExerciseResult = await jsonRequest('/api/training-plans', coachToken, {
    method: 'POST',
    body: JSON.stringify({ athleteId: 1, data: nineExerciseData })
  });
  if (nineExerciseResult.response.status !== 400) throw new Error('服务器未拒绝超过8个训练项目的计划。');

  const overPercentageData = structuredClone(plan.data);
  overPercentageData.exercises[0].lines[0].weeks['1'].percentage = 100.1;
  const overPercentageResult = await jsonRequest('/api/training-plans', coachToken, {
    method: 'POST',
    body: JSON.stringify({ athleteId: 1, data: overPercentageData })
  });
  if (overPercentageResult.response.status !== 400) throw new Error('服务器未拒绝超过100%的计划重量。');

  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3T10AAAAASUVORK5CYII=',
    'base64'
  );
  const form = new FormData();
  form.append('photo', new Blob([pngBytes], { type: 'image/png' }), 'athlete-photo.png');
  const photoResult = await jsonRequest('/api/athletes/1/photo', coachToken, { method: 'POST', body: form });
  if (!photoResult.response.ok || !photoResult.payload?.photoUrl) {
    throw new Error(`证件照上传失败：${photoResult.payload?.message}`);
  }

  const athleteWrite = await jsonRequest('/api/training-plans', athleteToken, {
    method: 'POST',
    body: JSON.stringify({ athleteId: 1, data: plan.data })
  });
  if (athleteWrite.response.status !== 403) throw new Error('运动员写入训练计划未被服务器拒绝。');
  const athleteDelete = await jsonRequest(`/api/training-plans/${saveResult.payload.id}`, athleteToken, { method: 'DELETE' });
  if (athleteDelete.response.status !== 403) throw new Error('运动员删除训练计划未被服务器拒绝。');
  const athleteRead = await jsonRequest('/api/training-plans?athleteId=1', athleteToken);
  if (!athleteRead.response.ok) throw new Error('运动员无法读取本人训练计划。');

  const exportResponse = await fetch(`${baseUrl}/api/training-plans/${saveResult.payload.id}/export`, {
    headers: { Authorization: `Bearer ${coachToken}` }
  });
  if (!exportResponse.ok) throw new Error(`导出失败：${await exportResponse.text()}`);
  await fs.writeFile(exportPath, Buffer.from(await exportResponse.arrayBuffer()));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(exportPath);
  const sheet = workbook.getWorksheet('个人体能计划');
  if (!sheet) throw new Error('导出文件缺少个人体能计划工作表。');
  const weightCell = sheet.getCell('G7').value;
  const formula = weightCell && typeof weightCell === 'object' && 'formula' in weightCell ? weightCell.formula : '';
  const result = weightCell && typeof weightCell === 'object' && 'result' in weightCell ? weightCell.result : null;
  if (!formula.includes('$A$7*F7') || result !== 45.5) throw new Error('MAX×百分比公式或缓存结果不正确。');
  if (sheet.getCell('H7').value !== 8) throw new Error('实际完成次数未保存为数值。');
  if (workbook.model.media.length !== 1) throw new Error('证件照未嵌入个人导出文件。');
  if (sheet.getCell('E1').value !== '2026.07.28—08.27') throw new Error('Excel未显示月度起止日期。');
  const expectedExerciseNames = plan.data.exercises
    .map((exercise) => exercise.name.trim().replace(/\s*\r?\n\s*/g, ' / ').replace(/\s{2,}/g, ' '))
    .filter(Boolean)
    .slice(0, 8)
    .join(' ｜ ');
  if (sheet.getCell('G3').value !== expectedExerciseNames) {
    throw new Error(`Excel顶部未按顺序显示项目名称：${String(sheet.getCell('G3').value)}`);
  }
  if (sheet.getCell('G3').value.includes('雷达口径') || sheet.getCell('G3').value.includes('实际平均重量')) {
    throw new Error('Excel顶部仍显示已删除的雷达口径说明。');
  }
  const itemValue = sheet.getCell('B7').value;
  if (itemValue !== '卧拉') throw new Error(`Excel项目格不是纯项目名称：${String(itemValue)}`);

  const nextMonthData = structuredClone(plan.data);
  nextMonthData.startDate = '2026-09-01';
  nextMonthData.endDate = '2026-09-30';
  nextMonthData.title = '九月体能训练计划';
  const createHistory = await jsonRequest('/api/training-plans', coachToken, {
    method: 'POST',
    body: JSON.stringify({ athleteId: 1, data: nextMonthData })
  });
  if (!createHistory.response.ok) throw new Error(`历史计划创建失败：${createHistory.payload?.message}`);
  const deleteHistory = await jsonRequest(`/api/training-plans/${createHistory.payload.id}`, coachToken, { method: 'DELETE' });
  if (!deleteHistory.response.ok) throw new Error(`历史计划删除失败：${deleteHistory.payload?.message}`);
  const afterDelete = await jsonRequest('/api/training-plans?athleteId=1', coachToken);
  if (afterDelete.payload.plans.some((item) => item.id === createHistory.payload.id)) throw new Error('历史计划删除后仍可读取。');

  console.log(JSON.stringify({
    coachCanSave: true,
    athleteCanRead: true,
    athleteWriteStatus: athleteWrite.response.status,
    athleteDeleteStatus: athleteDelete.response.status,
    nineExerciseStatus: nineExerciseResult.response.status,
    overPercentageStatus: overPercentageResult.response.status,
    coachCanDeleteHistory: true,
    monthlyPeriod: `${plan.data.startDate}—${plan.data.endDate}`,
    photoBound: true,
    embeddedImages: workbook.model.media.length,
    weightFormula: formula,
    calculatedWeight: result,
    actualCompletedRepetitions: sheet.getCell('H7').value,
    itemProjectOnly: itemValue,
    headerProjectNames: sheet.getCell('G3').value,
    exportBytes: (await fs.stat(exportPath)).size
  }, null, 2));
} finally {
  server.kill();
}
