import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { memoryStorage } from 'multer';
import { env } from '../env';

const MAX_MB = 10;

/** File type from its first bytes (the client's Content-Type can't be trusted). */
function sniff(buf: Buffer): string | undefined {
  const head = (n: number) => buf.subarray(0, n);
  if (head(4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (head(3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (head(4).toString('latin1') === 'GIF8') return 'gif';
  if (
    head(4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp';
  if (head(5).toString('latin1') === '%PDF-') return 'pdf';
  if (/<svg[\s>]/i.test(head(2048).toString('utf8'))) return 'svg'; // served sandboxed, see app.setup.ts
}

/**
 * Logo, background, PDF and block images. Returns the public URL to put in the page config.
 * ponytail: local disk (UPLOAD_DIR); move to object storage (S3, Vercel Blob…) before running more than one instance
 */
@Controller('uploads')
export class UploadsController {
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file)
      throw new BadRequestException(
        `Envie um arquivo no campo "file" (até ${MAX_MB} MB).`,
      );
    const ext = sniff(file.buffer);
    if (!ext)
      throw new BadRequestException(
        'Formato não suportado. Use PNG, JPG, WEBP, GIF, SVG ou PDF.',
      );

    const name = `${randomUUID()}.${ext}`;
    await mkdir(env.UPLOAD_DIR, { recursive: true });
    await writeFile(join(env.UPLOAD_DIR, name), file.buffer);
    return { url: `${env.PUBLIC_URL}/uploads/${name}` };
  }
}
