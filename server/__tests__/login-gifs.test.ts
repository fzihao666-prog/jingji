import { readdir, stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const sources = resolve('public/assets/olympic-sports');
const targets = [
  { dir: resolve('public/assets/olympic-sports-login-v1'), size: 144, budget: 4 * 1024 * 1024 },
  { dir: resolve('WeChat Mini Program/assets/olympic-sports-login-v1'), size: 48, budget: 500 * 1024 },
];

describe('登录 GIF 裁剪与动画完整性', () => {
  it('两端全部 50 个动图尺寸正确，保留帧数、播放时序及循环，满足体积预算', async () => {
    const files = (await readdir(sources)).filter((file) => file.endsWith('.gif'));
    expect(files).toHaveLength(50);
    const totals = [0, 0];
    for (const file of files) {
      const original = await sharp(resolve(sources, file), { animated: true }).metadata();
      for (const [index, target] of targets.entries()) {
        const output = resolve(target.dir, file);
        const result = await sharp(output, { animated: true }).metadata();
        expect(result.format).toBe('gif');
        expect(result.width).toBe(target.size);
        expect(result.pageHeight).toBe(target.size);
        expect(result.pages).toBe(original.pages);
        expect(result.delay).toEqual(original.delay);
        expect(result.loop).toBe(original.loop);
        totals[index] += (await stat(output)).size;
      }
    }
    targets.forEach((target, index) => expect(totals[index]).toBeLessThan(target.budget));
  });

  it('动画中间帧与两端原先可见的居中裁剪区域一致', async () => {
    for (const file of ['archery.gif', 'rowing.gif', 'athletics.gif']) {
      const input = resolve(sources, file);
      const metadata = await sharp(input, { animated: true }).metadata();
      const page = Math.floor(metadata.pages! / 2);
      for (const [index, target] of targets.entries()) {
        const side = Math.round(Math.min(metadata.width!, metadata.pageHeight!) / (index === 0 ? 1.5 : 1));
        const expected = await sharp(input, { page, pages: 1 }).extract({
          left: Math.round((metadata.width! - side) / 2),
          top: Math.round((metadata.pageHeight! - side) / 2), width: side, height: side,
        }).resize(target.size, target.size).removeAlpha().raw().toBuffer();
        const actual = await sharp(resolve(target.dir, file), { page, pages: 1 }).removeAlpha().raw().toBuffer();
        expect(actual.length).toBe(expected.length);
        const meanError = actual.reduce((sum, value, offset) => sum + Math.abs(value - expected[offset]!), 0) / actual.length;
        expect(meanError).toBeLessThan(8);
      }
    }
  });

  it('网页使用新版本资源，去除重复缩放，其他组件保留原图', async () => {
    const page = await readFile(resolve('src/pages/LoginPage.tsx'), 'utf8');
    expect(page).toContain('/assets/olympic-sports-login-v1/');
    expect(page).not.toContain('/assets/olympic-sports/');
    const styles = await readFile(resolve('src/styles/01-login.css'), 'utf8');
    expect(styles).not.toContain('transform: scale(1.5)');
  });
});
