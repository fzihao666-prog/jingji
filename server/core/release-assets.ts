import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const hashedAssetPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export function previousReleaseAssets(directory: string) {
  const marker = resolve(directory, 'previous');
  const version = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
  const previous = /^[0-9a-fA-F]+$/.test(version)
    ? express.static(resolve(directory, version), {
        immutable: true,
        maxAge: '1y',
        index: false,
        redirect: false,
      })
    : null;

  return express.Router()
    .use((req, res, next) => {
      if (previous && hashedAssetPattern.test(req.path.slice(1))) {
        previous(req, res, next);
      } else {
        next();
      }
    })
    .use((_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).json({ message: '文件不存在。' });
    });
}
