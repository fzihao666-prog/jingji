import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeAthletePhotoFile } from './uploads.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('运动员证件照文件替换清理', () => {
  it('删除上传目录内的旧证件照文件', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'jingji-athlete-photo-'));
    temporaryDirectories.push(directory);
    const filename = 'athlete-7-11111111-1111-4111-8111-111111111111.jpg';
    const filePath = resolve(directory, filename);
    writeFileSync(filePath, 'old-photo');

    removeAthletePhotoFile(filename, directory);

    expect(existsSync(filePath)).toBe(false);
  });

  it('拒绝删除上传目录之外的文件', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'jingji-athlete-photo-'));
    temporaryDirectories.push(directory);
    const outsideFile = resolve(directory, '..', 'outside-athlete-photo.jpg');
    writeFileSync(outsideFile, 'keep');

    removeAthletePhotoFile('../outside-athlete-photo.jpg', directory);

    expect(existsSync(outsideFile)).toBe(true);
    await rm(outsideFile);
  });
});
