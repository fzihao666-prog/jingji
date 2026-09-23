import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export async function checkDailyExampleCreation(assert) {
  const directory = mkdtempSync(join(tmpdir(), 'jingji-daily-example-check-'));
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          fileURLToPath(new URL('./coach-daily-todos-example.ts', import.meta.url)),
        ],
        { cwd: directory, stdio: 'ignore' }
      );
      child.once('error', reject);
      child.once('exit', resolve);
    });
  try {
    const results = await Promise.all([run(), run()]);
    assert(results.filter((code) => code === 0).length === 1, '并发生成场景库必须只有一个成功');
    assert(results.filter((code) => code === 1).length === 1, '第二个创建者必须拒绝覆盖');
    const files = readdirSync(join(directory, 'tmp')).filter((file) => file.endsWith('.db'));
    assert(files.length === 1, '并发生成只应产生一个场景库');
    const db = new DatabaseSync(join(directory, 'tmp', files[0]), { readOnly: true });
    try {
      const records = db
        .prepare(
          "SELECT COUNT(*) AS count FROM training_sessions WHERE source = 'coach_daily_example' AND is_demo = 0 AND quality = 'valid'"
        )
        .get();
      assert(records.count === 5, '样例训练必须为五条正式记录，不能并发重复累计');
    } finally {
      db.close();
    }
    assert((await run()) === 1, '再次生成必须拒绝覆盖已有场景库');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
