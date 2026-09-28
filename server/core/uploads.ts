import multer from 'multer';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const athletePhotoRoot = resolve(
  process.env.ATHLETE_PHOTO_ROOT || resolve(process.cwd(), 'data', 'uploads', 'athlete-photos')
);
mkdirSync(athletePhotoRoot, { recursive: true });

/**
 * 安全转码：只接受 JPEG/PNG Buffer，解码后重编码为 JPEG。
 * 返回重编码后的 Buffer；非法输入抛出异常。
 */
export async function transcodeAthletePhoto(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer, { failOn: 'error' });
  const metadata = await image.metadata();
  if (!metadata.format || !['jpeg', 'png', 'jpg'].includes(metadata.format)) {
    throw new Error('证件照仅支持 JPG 或 PNG。');
  }
  return image
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

export const dataImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!/\.(xls|xlsx)$/i.test(file.originalname))
      return callback(new Error('统一数据导入当前仅支持 XLS 和 XLSX 文件。'));
    callback(null, true);
  },
});

export const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      callback(new Error('证件照仅支持 JPG 或 PNG。'));
      return;
    }
    callback(null, true);
  },
});
