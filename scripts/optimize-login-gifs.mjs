import sharp from 'sharp';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// 两端分别匹配现有 aspectFill 与 cover + scale(1.5)，所有帧使用同一个居中裁剪框。
const sourceDir = resolve('public/assets/olympic-sports');
const miniOnly = process.argv.includes('--mini-only');
const targets = [
  { dir: resolve('public/assets/olympic-sports-login-v1'), size: 144, zoom: 1.5, colours: 16 },
  { dir: resolve('WeChat Mini Program/assets/olympic-sports-login-v1'), size: 48, zoom: 1, colours: 4 },
].filter((target) => !miniOnly || target.dir.includes('WeChat Mini Program'));
for (const target of targets) await mkdir(target.dir, { recursive: true });
let originalBytes = 0;
const totals = targets.map(() => 0);
for (const name of (await readdir(sourceDir)).filter((name) => name.endsWith('.gif')).sort()) {
  const input = resolve(sourceDir, name);
  const metadata = await sharp(input, { animated: true }).metadata();
  const { data, info } = await sharp(input, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pages = metadata.pages || 1;
  const frameHeight = metadata.pageHeight || metadata.height;
  const frameBytes = info.width * frameHeight * info.channels;
  originalBytes += (await stat(input)).size;
  for (const [index, target] of targets.entries()) {
    const side = Math.round(Math.min(info.width, frameHeight) / target.zoom);
    const crop = { left: Math.round((info.width - side) / 2), top: Math.round((frameHeight - side) / 2), width: side, height: side };
    const frames = [];
    for (let frame = 0; frame < pages; frame++) {
      frames.push(await sharp(data.subarray(frame * frameBytes, (frame + 1) * frameBytes), {
        raw: { width: info.width, height: frameHeight, channels: info.channels },
      }).extract(crop).resize(target.size, target.size).raw().toBuffer());
    }
    const output = resolve(target.dir, name);
    const encoded = await sharp(Buffer.concat(frames), {
      raw: { width: target.size, height: target.size * pages, channels: info.channels, pageHeight: target.size },
    }).gif({ delay: metadata.delay, loop: metadata.loop, colours: 64, dither: 0, effort: 7, keepDuplicateFrames: true }).toBuffer();
    // 二次编码复用帧差分；蓝白图标使用小调色板，减少随包体积。
    await sharp(encoded, { animated: true }).gif({ colours: target.colours, dither: 0, effort: 10, interFrameMaxError: 8, interPaletteMaxError: 8, keepDuplicateFrames: true }).toFile(output);
    const result = await sharp(output, { animated: true }).metadata();
    if (result.pages !== pages || result.loop !== metadata.loop || JSON.stringify(result.delay) !== JSON.stringify(metadata.delay)) {
      throw new Error(`动画帧数、时序或循环发生变化：${output}`);
    }
    totals[index] += (await stat(output)).size;
  }
  console.log(`已处理 ${name}`);
}
console.log(JSON.stringify({ originalBytes, outputs: targets.map((target, index) => ({ dir: target.dir, bytes: totals[index] })) }));
